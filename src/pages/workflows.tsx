import { useMemo } from "react"
import { useNavigate } from "react-router"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { useNodeHealth, useRegistry } from "@/hooks/use-registry"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { hasTag, matchesText, sortRows } from "@/lib/deployed-list"
import { channelsRunning, workflowShares, type DeployedRegistry } from "@/lib/deployed-registry"
import { memberRefKey } from "@/lib/deployment-diff"
import { countLeafSteps, workflowSteps } from "@/lib/workflow-steps"
import type { Channel, Workflow } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { NoMatches } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { NothingDeployedState, QuarantineBadge } from "@/components/shared/deployed-state"
import { FilterBar, FilterTextInput } from "@/components/shared/filter-bar"
import { plural } from "@/lib/utils"
import { GitBranch } from "lucide-react"

/** One row per workflow id; a canary's several deployed revisions ride on it. */
interface WorkflowRow {
  workflow: Workflow
  /** Every deployed revision, newest first, with its share of its channels' buckets. */
  revisions: { revision: number; share: number; entity: Workflow["member"]["entity"] }[]
  runsOn: Channel[]
}

const columnHelper = createColumnHelper<typeof listTableFeatures, WorkflowRow>()

const FILTER_KEYS = ["tag", "q"] as const

/** Column id → the sort key the URL carries. */
const SORT_FIELDS: Record<string, string> = { name: "name", tasks: "tasks", runs_on: "runs_on" }

function sortValue(r: WorkflowRow, field: string) {
  if (field === "name") return r.workflow.name
  if (field === "tasks") return countLeafSteps(workflowSteps(r.workflow))
  if (field === "runs_on") return r.runsOn.length
  return null
}

function buildRows(registry: Pick<DeployedRegistry, "channels" | "workflows" | "workflowRevisions">): WorkflowRow[] {
  const shares = workflowShares(registry.channels)
  return registry.workflows.map((workflow) => ({
    workflow,
    revisions: registry.workflowRevisions
      .filter((w) => w.workflow_id === workflow.workflow_id)
      .map((w) => ({ revision: w.revision, share: shares.get(`${w.workflow_id}@${w.revision}`) ?? 0, entity: w.member.entity })),
    runsOn: channelsRunning(registry, workflow.workflow_id),
  }))
}

/**
 * Columns take the quarantine set and which channels run each workflow — a
 * deployed workflow no channel requires is dead weight, and the list says so.
 */
function buildColumns(quarantined: ReadonlyMap<string, string>) {
  return columnHelper.columns([
    columnHelper.accessor((r) => r.workflow.name, {
      id: "name",
      header: "Name",
      cell: (info) => {
        const r = info.row.original
        const reason = r.revisions.map((v) => quarantined.get(memberRefKey(v.entity))).find(Boolean)
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{r.workflow.name}</span>
            {r.workflow.workflow_id !== r.workflow.name && (
              <span className="font-mono text-xs text-muted-foreground">{r.workflow.workflow_id}</span>
            )}
            <QuarantineBadge reason={reason} />
          </span>
        )
      },
    }),
    columnHelper.accessor((r) => r.workflow.tags, {
      id: "tags",
      header: "Tags",
      cell: (info) => {
        const tags = info.getValue()
        if (!tags || tags.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{tags.length - 3}
              </Badge>
            )}
          </div>
        )
      },
    }),
    columnHelper.display({
      id: "revision",
      header: "Revision",
      cell: (info) => {
        const revs = info.row.original.revisions
        if (revs.length === 1) return <span className="font-mono text-xs text-muted-foreground">r{revs[0].revision}</span>
        return (
          <span className="font-mono text-xs" title="A canary: its channels split their buckets across these revisions">
            {revs.map((v) => `r${v.revision} ${v.share}%`).join(" · ")}
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "runs_on",
      header: "Runs on",
      cell: (info) => {
        const channels = info.row.original.runsOn
        if (channels.length === 0) {
          return (
            <span className="text-xs text-warning" title="Deployed, but no channel requires it — nothing reaches this workflow">
              no channel
            </span>
          )
        }
        return (
          <span className="text-xs text-muted-foreground" title={channels.map((c) => c.name).join(", ")}>
            {channels.length === 1 ? channels[0].name : plural(channels.length, "channel")}
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "tasks",
      header: "Tasks",
      // Leaf count, not `tasks.length`: a task group is one array element holding
      // a whole span, so the raw length under-reports a grouped workflow.
      // A loop's setup steps count too — the engine runs them.
      cell: (info) => (
        <span className="text-muted-foreground">{countLeafSteps(workflowSteps(info.row.original.workflow))}</span>
      ),
    }),
  ])
}

export function WorkflowsPage() {
  const navigate = useNavigate()
  const { filters, update, clear, hasFilters, sort, sortBy, sortOrder, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
  )
  const registry = useRegistry()
  const { quarantined } = useNodeHealth()
  const columns = useMemo(() => buildColumns(quarantined), [quarantined])
  const all = useMemo(
    () => buildRows(registry),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the registry's arrays are its identity
    [registry.channels, registry.workflows, registry.workflowRevisions],
  )
  const search = filters.q.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      sortRows(
        all.filter((r) => matchesText(search, r.workflow.name, r.workflow.workflow_id) && hasTag(r.workflow.tags, filters.tag)),
        sortBy,
        sortOrder,
        sortValue,
      ),
    [all, search, filters.tag, sortBy, sortOrder],
  )
  const rows = filtered.slice(offset, offset + PAGE_SIZE)
  const table = useTable({ features: listTableFeatures, data: rows, columns })

  if (registry.error && registry.workflows.length === 0) {
    return <ErrorState title="Failed to read the deployed workflows" error={registry.error} onRetry={registry.refetch} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Workflows" description="The pipelines the head deploys: inspect, compare and test them" />

      <FilterBar>
        <FilterTextInput
          value={filters.q}
          onChange={(q) => update({ q })}
          placeholder="Name or id contains…"
          ariaLabel="Search workflows"
          className="w-full sm:w-56"
        />
        <FilterTextInput
          value={filters.tag}
          onChange={(tag) => update({ tag })}
          placeholder="Exact tag..."
          ariaLabel="Filter by tag"
          title="Matches one whole tag, not part of one"
        />
      </FilterBar>

      <EntityTable
        table={table}
        isLoading={registry.isLoading && registry.workflows.length === 0}
        sort={sort}
        onOpen={(r) => navigate(`/workflows/${encodeURIComponent(r.workflow.workflow_id)}`)}
        empty={
          hasFilters ? (
            <NoMatches noun="workflows" onClear={clear} />
          ) : (
            <NothingDeployedState
              icon={GitBranch}
              noun="workflows"
              headEmpty={registry.empty}
              what="Workflows are the task pipelines a channel runs."
            />
          )
        }
      />

      <PaginationFooter offset={offset} count={rows.length} total={filtered.length} onPrev={prev} onNext={next} />
    </div>
  )
}
