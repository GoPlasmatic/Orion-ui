import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useModels, useImportModels } from "@/hooks/use-models"
import { useHealth } from "@/hooks/use-health"
import { useExport } from "@/hooks/use-export"
import { modelsApi } from "@/api/models"
import { ADMISSION_STATES } from "@/api/types"
import type { AdmissionState, CreateModelRequest, EntityStatus, Model } from "@/api/types"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ImportDialog } from "@/components/shared/import-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { StatusBadge } from "@/components/shared/status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { admissionStateBadgeClass, modelHealthBadgeClass } from "@/lib/status"
import { admissionFailure } from "@/lib/model-manifest"
import { formatBytes, formatDate, formatWhen, downloadJson } from "@/lib/utils"
import { Boxes, Download, Plus, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Model>()

const FILTER_KEYS = ["status", "admission", "tag"] as const

/** Column id → the server's `sort_by` field. */
const SORT_FIELDS: Record<string, string> = {
  model_id: "model_id",
  status: "status",
  updated_at: "updated_at",
}

/**
 * A parameter count. Exact below 10k, abbreviated above it — because the
 * graphs this feature is for are small by design (a policy over a board, a
 * score over a feature vector), and at that size the digits are the point: a
 * workflow scoring a competition reads `parameters` precisely because it does
 * not trust the entrant's claim. `1,479` says more than `1.5k`.
 */
function formatCount(n: number | null | undefined): string | null {
  if (n == null) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

/**
 * Columns take this node's residency map. Like a plugin's load state it is per
 * replica — but unlike a plugin, a model also carries a *cluster-wide* verdict
 * (`admission`), and the two answer different questions: the verdict says
 * whether any node ever verified the bytes, residency says whether this one
 * has them in memory now. Both get a column.
 */
function buildColumns(residency: ReadonlyMap<string, string>) {
  return columnHelper.columns([
    columnHelper.accessor("model_id", {
      header: "Model",
      cell: (info) => (
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">
            {info.row.original.model_version} · {info.row.original.format}
          </p>
        </div>
      ),
    }),
    columnHelper.accessor((row) => row.admission.state, {
      id: "admission",
      header: "Admission",
      cell: (info) => {
        const { admission } = info.row.original
        const { state, node } = admission
        const title =
          state === "failed"
            ? admissionFailure(admission)
            : state === "passed"
              ? `Verified${node ? ` by ${node}` : ""} — the artifact was fetched, hashed and probed`
              : "No node has verified the artifact yet"
        return (
          <Badge variant="outline" className={admissionStateBadgeClass(state)} title={title}>
            {state}
          </Badge>
        )
      },
    }),
    columnHelper.accessor((row) => row.stats?.parameters ?? null, {
      id: "parameters",
      header: "Parameters",
      cell: (info) => {
        const row = info.row.original
        const params = formatCount(row.stats?.parameters)
        if (!params) {
          return (
            <span className="text-xs text-muted-foreground" title="Read from the graph at admission">
              —
            </span>
          )
        }
        const size = row.stats?.artifact_bytes ?? row.artifact.size
        return (
          <div className="min-w-0" title={`${row.stats?.parameters?.toLocaleString()} parameters`}>
            <p className="text-sm tabular-nums">{params}</p>
            {size != null && (
              <p className="text-xs text-muted-foreground tabular-nums">{formatBytes(size)}</p>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.accessor("digest", {
      id: "node",
      header: "This node",
      cell: (info) => {
        const row = info.row.original
        const state = residency.get(row.digest)
        if (!state) {
          return (
            <span
              className="text-xs text-muted-foreground"
              title={
                row.status === "active"
                  ? "Not resident here — nothing has asked for it, or the node has not loaded it"
                  : "Only an active version is loaded"
              }
            >
              —
            </span>
          )
        }
        return (
          <Badge variant="outline" className={modelHealthBadgeClass(state)}>
            {state}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("version", {
      header: "Version",
      cell: (info) => <span className="text-muted-foreground">v{info.getValue()}</span>,
    }),
    columnHelper.accessor("updated_at", {
      header: "Updated",
      cell: (info) => (
        <span className="text-muted-foreground" title={formatDate(info.getValue())}>
          {formatWhen(info.getValue())}
        </span>
      ),
    }),
  ])
}

/**
 * Models (Orion 1.8): ONNX graphs a workflow runs with `model_infer`. A model
 * is a versioned entity beside channels, workflows, connectors and plugins, so
 * the page is shaped like theirs — with one column no other entity has, the
 * admission verdict, because a model that has not been verified cannot be
 * activated at all.
 */
export function ModelsPage() {
  const navigate = useNavigate()
  const { filters, update, sortQuery, sort, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
  )
  const statusFilter = filters.status as EntityStatus | ""
  const admissionFilter = filters.admission as AdmissionState | ""
  const [showImport, setShowImport] = useState(false)
  const { data: health } = useHealth()
  const importModels = useImportModels()

  const query = {
    status: statusFilter || undefined,
    admission: admissionFilter || undefined,
    tag: filters.tag || undefined,
  }
  const { data, isLoading, error, refetch } = useModels({
    limit: PAGE_SIZE,
    offset,
    ...query,
    ...sortQuery,
  })

  // `/health` reports residency by digest, which is the identity a generation,
  // a trace and a package all name a model by — so the join needs no id.
  const residency = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of health?.models?.loaded ?? []) m.set(l.digest, "loaded")
    for (const f of health?.models?.failed_to_load ?? []) m.set(f.digest, "failed")
    return m
  }, [health?.models])
  const columns = useMemo(() => buildColumns(residency), [residency])

  const table = useTable({ features: listTableFeatures, data: data?.data ?? [], columns })

  // References only — a model never travels as bytes. The target fetches the
  // object through its own connector of that name and admits it itself, which
  // is why the connector has to be promoted first.
  const exportAll = useExport(async () => {
    const models = await modelsApi.export(query)
    downloadJson(models, "orion-models")
    return {
      message: `Exported ${models.length} model${models.length !== 1 ? "s" : ""}`,
      description: "Artifact references only — the bytes stay in the bucket",
    }
  })

  const runtime = health?.components?.models
  const failedLoads = health?.models?.failed_to_load ?? []

  return (
    <div className="space-y-6">
      <PageHeader title="Models" description="ONNX graphs a workflow runs with model_infer">
        <Button variant="outline" onClick={exportAll.run} disabled={exportAll.pending}>
          <Download className="h-4 w-4" />
          {exportAll.pending ? "Exporting..." : "Export"}
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="h-4 w-4" />
          Import
        </Button>
        <Button onClick={() => navigate("/models/new")}>
          <Plus className="h-4 w-4" />
          Register Model
        </Button>
      </PageHeader>

      {showImport && (
        <ImportDialog
          title="Import Models"
          onImport={(items, opts) =>
            importModels.mutateAsync({ items: items as CreateModelRequest[], ...opts })
          }
          onClose={() => setShowImport(false)}
        />
      )}

      {runtime === "disabled" && (
        <Callout variant="info">
          The model runtime is off on this node (<code className="font-mono">models.enabled =
          false</code>). Registering, admitting or activating a model answers 400 here — reads
          still work — and a stored active model quarantines the workflows naming it rather than
          running them. Every node in a cluster must agree.
        </Callout>
      )}
      {runtime === "degraded" && (
        <Callout variant="warning">
          {failedLoads.length > 0
            ? `${failedLoads.length} active model version${failedLoads.length === 1 ? "" : "s"} could not be carried by this node's generation — the workflows naming ${failedLoads.length === 1 ? "it" : "them"} are quarantined.`
            : "This node's admission worker is down: a new registration will wait for its verdict indefinitely."}{" "}
          <Link to="/engine" className="underline underline-offset-2">
            See the health report
          </Link>
        </Callout>
      )}

      <FilterBar>
        <Select
          value={statusFilter}
          onChange={(e) => update({ status: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
        <Select
          value={admissionFilter}
          onChange={(e) => update({ admission: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by admission verdict"
        >
          <option value="">Any verdict</option>
          {ADMISSION_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Input
          value={filters.tag}
          onChange={(e) => update({ tag: e.target.value })}
          placeholder="Filter by tag..."
          className={FILTER_W}
          aria-label="Filter by tag"
        />
      </FilterBar>

      {error ? (
        <ErrorState title="Failed to load models" error={error} onRetry={() => refetch()} />
      ) : (
        <EntityTable
          table={table}
          isLoading={isLoading}
          sort={sort}
          onOpen={(model) => navigate(`/models/${encodeURIComponent(model.model_id)}`)}
          empty={
            <EmptyState
              icon={Boxes}
              title="No models yet"
              description="A model is an ONNX graph on the hot path — a fraud score, a routing decision, a classifier over a fixed feature vector. Orion never holds the bytes: you register a manifest and a reference to an object in a storage bucket, and the node fetches, verifies and probes it before it will serve."
              action={
                <>
                  <Button variant="outline" onClick={() => setShowImport(true)}>
                    <Upload className="h-4 w-4" /> Import
                  </Button>
                  <Button onClick={() => navigate("/models/new")}>
                    <Plus className="h-4 w-4" /> Register Model
                  </Button>
                </>
              }
            />
          }
        />
      )}

      <PaginationFooter
        offset={offset}
        count={data?.data.length ?? 0}
        total={data?.total}
        onPrev={prev}
        onNext={next}
      />
    </div>
  )
}
