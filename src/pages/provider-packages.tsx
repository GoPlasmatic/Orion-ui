import { useMemo } from "react"
import { useNavigate } from "react-router"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { useProviderPackageList } from "@/hooks/use-provider-packages"
import { useConnectionRevisions } from "@/hooks/use-connections"
import { useRuntimeCapabilities, editionAtLeast } from "@/hooks/use-runtime-capabilities"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { listTableFeatures } from "@/lib/table"
import { useUrlFilters } from "@/lib/use-url-filters"
import { shortDigest } from "@/lib/deployment-diff"
import type { ConnectorPackageSummary, EditionTier } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { LoadMoreFooter } from "@/components/shared/load-more"
import { PackageStateBadge, TierBadge } from "@/components/packages/package-badges"
import { PackageStudio } from "@/components/packages/package-studio"
import { UploadPackageDialog } from "@/components/packages/upload-dialog"
import { plural } from "@/lib/utils"
import { Package, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, ConnectorPackageSummary>()

function buildColumns(edition: EditionTier | undefined, usedBy: ReadonlyMap<string, number>) {
  return columnHelper.columns([
    columnHelper.accessor("provider_id", {
      header: "Provider",
      cell: (info) => {
        const p = info.row.original
        return (
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium">{p.provider_id}</p>
            <p className="text-xs text-muted-foreground">{p.publisher}</p>
          </div>
        )
      },
    }),
    columnHelper.accessor("version", {
      header: "Version",
      cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
    }),
    columnHelper.accessor("implementation", {
      header: "Implementation",
      cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
    }),
    columnHelper.accessor("tier", {
      header: "Tier",
      cell: (info) => <TierBadge tier={info.getValue()} edition={edition} />,
    }),
    columnHelper.display({
      id: "state",
      header: "State",
      cell: (info) => <PackageStateBadge pkg={info.row.original} />,
    }),
    columnHelper.display({
      id: "used_by",
      header: "Connections",
      cell: (info) => {
        const n = usedBy.get(info.row.original.digest) ?? 0
        return <span className="text-xs text-muted-foreground">{n === 0 ? "none" : plural(n, "revision")}</span>
      },
    }),
    columnHelper.accessor("digest", {
      header: "Digest",
      cell: (info) => (
        <span className="font-mono text-xs text-muted-foreground" title={info.getValue()}>
          {shortDigest(info.getValue())}
        </span>
      ),
    }),
  ])
}

const URL_KEYS = ["tab", "upload"] as const

/**
 * Provider packages: connector providers shipped as files — a workflow
 * composite or a WebAssembly component — stored by digest and admitted under
 * this node's policy before a connection may name one. The Studio tab
 * scaffolds, lints and packs one in the browser.
 */
export function ProviderPackagesPage() {
  const navigate = useNavigate()
  const { values, set } = useUrlFilters(URL_KEYS)
  const tab = values.tab === "studio" ? "studio" : "packages"
  const list = useProviderPackageList()
  const revisions = useConnectionRevisions()
  const runtime = useRuntimeCapabilities()
  const canMutate = useCanMutate()
  const edition = runtime.data?.edition

  const usedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of revisions.data?.rows ?? []) m.set(r.provider_digest, (m.get(r.provider_digest) ?? 0) + 1)
    return m
  }, [revisions.data])
  const columns = useMemo(() => buildColumns(edition, usedBy), [edition, usedBy])
  const table = useTable({ features: listTableFeatures, data: list.rows, columns })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Packages"
        description="Connector providers shipped as packages: upload, admit, revoke — and author one in the studio"
      >
        <Button
          onClick={() => set({ upload: "1" })}
          disabled={!canMutate}
          title={canMutate ? "Store a package's files on the server" : READ_ONLY_REASON}
        >
          <Upload className="h-4 w-4" /> Upload
        </Button>
      </PageHeader>

      {values.upload && <UploadPackageDialog onClose={() => set({ upload: "" })} />}

      <Tabs defaultValue="packages" value={tab} onValueChange={(v) => set({ tab: v === "packages" ? "" : v })}>
        <TabsList>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="studio">Studio</TabsTrigger>
        </TabsList>

        <TabsContent value="packages" className="space-y-3">
          {edition && !editionAtLeast(edition, "standard") && (
            <p className="text-sm text-muted-foreground">
              This node is Community: it admits community-tier packages; a Standard or Enterprise package can be
              stored here but needs that edition to be admitted.
            </p>
          )}
          {list.error && list.rows.length === 0 ? (
            <ErrorState title="Failed to load provider packages" error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <>
              <EntityTable
                table={table}
                isLoading={list.isLoading}
                onOpen={(p) => navigate(`/provider-packages/${encodeURIComponent(p.digest)}`)}
                empty={
                  <EmptyState
                    icon={Package}
                    title="No provider packages yet"
                    description="The built-in drivers (HTTP, SQL, cache) need no package. A package brings another provider — author one in the Studio, or upload one from disk."
                    action={
                      <Button variant="outline" onClick={() => set({ tab: "studio" })}>
                        Open the studio
                      </Button>
                    }
                  />
                }
              />
              <LoadMoreFooter
                count={list.rows.length}
                total={list.total}
                hasMore={list.hasMore}
                pending={list.isFetchingMore}
                onLoadMore={list.loadMore}
                noun="package"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="studio">
          <PackageStudio />
        </TabsContent>
      </Tabs>
    </div>
  )
}
