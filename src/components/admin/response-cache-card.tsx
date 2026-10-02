import { useMemo } from "react"
import { Link } from "react-router"
import type { CacheConfig } from "@/api/types"
import { useChannels } from "@/hooks/use-channels"
import { useCacheHitsByChannel } from "@/hooks/use-ops-metrics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InvalidateNamespaceButton } from "@/components/admin/invalidate-namespace"
import { cacheNamespaces, hitRatio } from "@/lib/cache-namespaces"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { formatPct } from "@/lib/traffic-encoding"
import { plural } from "@/lib/utils"
import { Fact } from "@/components/shared/fact"
import { DatabaseZap } from "lucide-react"

/**
 * A channel's response cache on its own page: how it stores (TTL, store,
 * coalescing), its hit ratio, and each invalidation namespace it declares
 * with who else shares it and an Invalidate button — the action an operator
 * reaches for after changing what the cached responses are built from.
 */
export function ResponseCacheCard({ channelName, cache }: { channelName: string; cache: CacheConfig }) {
  const { data: registry } = useChannels({ limit: REGISTRY_LIMIT })
  const cacheHits = useCacheHitsByChannel()
  const shared = useMemo(() => {
    const byNs = new Map(cacheNamespaces(registry?.data ?? []).map((r) => [r.namespace, r]))
    return (cache.namespaces ?? []).map((ns) => ({
      namespace: ns,
      channels: byNs.get(ns)?.channels.map((c) => c.name) ?? [channelName],
    }))
  }, [registry, cache.namespaces, channelName])
  const ratio = hitRatio([channelName], cacheHits.byChannel)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-muted-foreground" /> Response cache
          </span>
          <Link to="/caches" className="text-xs font-normal text-muted-foreground hover:text-foreground">
            All caches
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact label="TTL">{cache.ttl_secs != null ? `${cache.ttl_secs}s` : "server default"}</Fact>
          <Fact label="Store">{cache.connector || "in-memory (this node)"}</Fact>
          <Fact label="Coalesce misses" mono={false}>
            {cache.coalesce_misses ? "on, per node" : "off"}
          </Fact>
          <Fact
            label="Hit ratio"
            title={
              ratio.pct == null
                ? "No lookups recorded on the node this console scrapes"
                : `${plural(ratio.hits, "hit")} · ${plural(ratio.misses, "miss", "misses")} since the server started`
            }
          >
            {formatPct(ratio.pct)}
          </Fact>
        </dl>

        {shared.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No invalidation namespaces: entries expire on their TTL alone. Declaring{" "}
            <code className="font-mono">cache.namespaces</code> lets them be dropped on demand.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {shared.map(({ namespace, channels }) => {
              const others = channels.filter((c) => c !== channelName)
              return (
                <li key={namespace} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/caches?namespace=${encodeURIComponent(namespace)}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {namespace}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {others.length === 0
                        ? "Only this channel declares it"
                        : `Shared with ${plural(others.length, "other channel")}`}
                    </p>
                  </div>
                  <InvalidateNamespaceButton namespace={namespace} channels={channels} />
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
