import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { useChannels } from "@/hooks/use-channels"
import { useCacheHitsByChannel } from "@/hooks/use-ops-metrics"
import { KpiCard } from "@/components/shared/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState, NoMatches } from "@/components/shared/empty-state"
import { ErrorState } from "@/components/shared/error-state"
import { FilterBar, FilterTextInput, FILTER_W } from "@/components/shared/filter-bar"
import { InvalidateNamespaceButton } from "@/components/admin/invalidate-namespace"
import { cacheNamespaces, hitRatio, lintNamespace, type CacheNamespace } from "@/lib/cache-namespaces"
import { useUrlFilters } from "@/lib/use-url-filters"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { cn, plural } from "@/lib/utils"
import { formatPct } from "@/lib/traffic-encoding"
import { metricsShort } from "@/lib/metrics-state"
import { DatabaseZap } from "lucide-react"

const KEYS = ["namespace", "q"] as const
/** Channels named in a row before "+n more". */
const SHOWN = 4

/**
 * The response cache's invalidation namespaces (Orion 1.10).
 *
 * The server has no listing endpoint, so the rows are read off the channel
 * registry: every `cache.namespaces` entry, the channels that declare it
 * (invalidating one drops all of their entries at once — the reason to see
 * who shares it before pressing the button) and those channels' hit ratio.
 * `?namespace=` highlights a row; audit rows for `invalidate` /
 * `cache_namespace` link here.
 */
export function CachesPage() {
  const { values, set } = useUrlFilters(KEYS)
  const channelsQuery = useChannels({ limit: REGISTRY_LIMIT })
  const cache = useCacheHitsByChannel()
  const rows = useMemo(() => cacheNamespaces(channelsQuery.data?.data ?? []), [channelsQuery.data])

  const q = values.q.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.namespace.includes(q) || r.channels.some((c) => c.name.toLowerCase().includes(q))) : rows
  const target = values.namespace
  const targetDeclared = !target || rows.some((r) => r.namespace === target)

  const metricsOff = cache.state === "off" || cache.state === "error"
  // Every channel with a lookup, not only those declaring a namespace: the
  // response cache as a whole, since the server started.
  const overall = hitRatio([...cache.byChannel.keys()], cache.byChannel)
  const declaring = new Set(rows.flatMap((r) => r.channels.map((c) => c.channel_id))).size
  const shared = rows.filter((r) => r.channels.length > 1).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caches"
        description="Response-cache namespaces declared across channels, who shares each one, and invalidation"
      />

      {channelsQuery.error ? (
        <ErrorState
          title="Failed to load the channel registry"
          error={channelsQuery.error}
          onRetry={() => channelsQuery.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard title="Namespaces" value={String(rows.length)} loading={channelsQuery.isLoading} />
            <KpiCard
              title="Channels declaring one"
              value={String(declaring)}
              loading={channelsQuery.isLoading}
            />
            <KpiCard
              title="Shared by several channels"
              value={String(shared)}
              hint="One invalidation drops entries across all of them"
              loading={channelsQuery.isLoading}
            />
            <KpiCard
              title="Hit ratio, every cached channel"
              value={formatPct(overall.pct)}
              hint={metricsOff ? metricsShort(cache.state) : "since the server started"}
              hintTitle={
                overall.pct == null
                  ? undefined
                  : `${plural(overall.hits, "hit")} · ${plural(overall.misses, "miss", "misses")}`
              }
              loading={cache.state === "loading"}
            />
          </div>

          {target && !targetDeclared && lintNamespace(target) == null && (
            <Callout variant="info">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  No channel in the registry declares{" "}
                  <code className="font-mono">{target}</code> now. Invalidating it still bumps its
                  counter in every cache store — harmless, and what to do if a channel declared it
                  until recently.
                </span>
                <InvalidateNamespaceButton namespace={target} channels={[]} size="sm" />
              </div>
            </Callout>
          )}

          <FilterBar>
            <FilterTextInput
              value={values.q}
              onChange={(v) => set({ q: v })}
              placeholder="Namespace or channel…"
              ariaLabel="Filter by namespace or channel name"
              className={cn(FILTER_W, "sm:w-64")}
            />
          </FilterBar>

          <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namespace</TableHead>
                  <TableHead>Declared by</TableHead>
                  <TableHead>Stores</TableHead>
                  <TableHead className="text-right">Hit ratio</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channelsQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : shown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      {rows.length > 0 ? (
                        <NoMatches noun="namespaces" onClear={() => set({ q: "" })} />
                      ) : (
                        <EmptyState
                          icon={DatabaseZap}
                          title="No cache namespaces declared"
                          description="A channel with its response cache on can name the namespaces its entries belong to (cache.namespaces in its configuration). Invalidating one — here, or from a workflow's cache_invalidate — drops every entry stored under it, across every channel that shares it."
                          action={
                            <Button variant="outline" asChild>
                              <Link to="/channels">Open channels</Link>
                            </Button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  shown.map((row) => (
                    <NamespaceRow
                      key={row.namespace}
                      row={row}
                      highlighted={row.namespace === target}
                      byChannel={cache.byChannel}
                      unavailable={metricsOff ? metricsShort(cache.state) : null}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Hit ratios per namespace are the declaring channels' lookups since each server started
            (the exporter labels hits by channel, not by namespace), on the node this console
            scrapes. Sizes and entry counts are not exposed by the server.
          </p>
        </>
      )}
    </div>
  )
}

function NamespaceRow({
  row,
  highlighted,
  byChannel,
  unavailable,
}: {
  row: CacheNamespace
  highlighted: boolean
  byChannel: Map<string, { hits: number; misses: number }>
  /** Why there is no ratio at all (metrics off or unreachable), or null. */
  unavailable: string | null
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center" })
  }, [highlighted])

  const ratio = hitRatio(
    row.channels.map((c) => c.name),
    byChannel
  )
  const visible = expanded ? row.channels : row.channels.slice(0, SHOWN)
  const inMemory = row.channels.some((c) => !c.connector)

  return (
    <TableRow ref={ref} className={cn(highlighted && "bg-accent")} aria-current={highlighted || undefined}>
      <TableCell className="align-top">
        <code className="font-mono text-sm font-medium">{row.namespace}</code>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.live} live of {row.channels.length} declaring
        </p>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-1">
          {visible.map((c) => (
            <Link
              key={c.channel_id}
              to={`/channels/${c.channel_id}`}
              title={`${c.name} · ${c.status}${c.cacheEnabled ? "" : " · cache off"}`}
            >
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-xs hover:bg-accent",
                  (c.status !== "active" || !c.cacheEnabled) && "border-dashed text-muted-foreground"
                )}
              >
                {c.name}
              </Badge>
            </Link>
          ))}
          {row.channels.length > SHOWN && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "show fewer" : `+${row.channels.length - SHOWN} more`}
            </button>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        <div className="flex flex-wrap gap-1">
          {row.connectors.map((name) => (
            <Badge key={name} variant="secondary" className="font-mono text-xs">
              {name}
            </Badge>
          ))}
          {inMemory && (
            <Badge variant="secondary" className="text-xs" title="A channel with no cache connector stores in this node's memory">
              in-memory
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell
        className="align-top text-right tabular-nums"
        title={
          unavailable
            ? unavailable
            : ratio.pct == null
              ? "No lookups recorded for these channels"
              : `${plural(ratio.hits, "hit")} · ${plural(ratio.misses, "miss", "misses")}`
        }
      >
        {ratio.pct == null ? <span className="text-muted-foreground">—</span> : formatPct(ratio.pct)}
      </TableCell>
      <TableCell className="align-top text-right">
        <InvalidateNamespaceButton namespace={row.namespace} channels={row.channels.map((c) => c.name)} />
      </TableCell>
    </TableRow>
  )
}
