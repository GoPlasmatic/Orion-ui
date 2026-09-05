import { useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  useCircuitBreakers,
  useResetCircuitBreaker,
  useResetCircuitBreakers,
  useConnectors,
} from "@/hooks/use-connectors"
import { useChannels } from "@/hooks/use-channels"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { breakerStateBadgeClass } from "@/lib/status"
import { cn } from "@/lib/utils"
import { RefreshCw, RotateCcw } from "lucide-react"

interface BreakerRow {
  key: string
  channel: string
  connector: string
  state: string
}

export function CircuitBreakersPage() {
  const queryClient = useQueryClient()
  // `?key=channel:connector` — the dashboard's breaker alert lands on its row.
  const [params] = useSearchParams()
  const highlighted = params.get("key")
  const scrolled = useRef(false)
  const { data, isLoading } = useCircuitBreakers({ refetchInterval: 15_000 })
  const { data: connectors } = useConnectors({ limit: 1000 })
  const { data: channels } = useChannels({ limit: 1000 })
  const reset = useResetCircuitBreaker()
  const resetMany = useResetCircuitBreakers()
  const [confirmAll, setConfirmAll] = useState(false)

  const connectorIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of connectors?.data ?? []) m.set(c.name, c.id)
    return m
  }, [connectors?.data])
  // A breaker key names the channel by *name*; the page needs its id.
  const channelIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of channels?.data ?? []) m.set(c.name, c.channel_id)
    return m
  }, [channels?.data])

  const rows: BreakerRow[] = useMemo(() => {
    return Object.entries(data?.breakers ?? {})
      .map(([key, state]) => {
        const sep = key.indexOf(":")
        const channel = sep === -1 ? "—" : key.slice(0, sep)
        const connector = sep === -1 ? key : key.slice(sep + 1)
        return { key, channel, connector, state }
      })
      .sort((a, b) => a.key.localeCompare(b.key))
  }, [data?.breakers])

  const counts = useMemo(() => {
    const c = { open: 0, half_open: 0, closed: 0 }
    for (const r of rows) {
      if (r.state === "open") c.open++
      else if (r.state === "closed") c.closed++
      else c.half_open++
    }
    return c
  }, [rows])
  const notClosed = rows.filter((r) => r.state !== "closed")

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })

  return (
    <div className="space-y-6">
      <PageHeader title="Circuit Breakers" description="Connector breaker states across the fleet">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmAll(true)}
          disabled={notClosed.length === 0 || resetMany.isPending}
          title="Reset every breaker that is open or half-open on this node"
        >
          <RotateCcw className="h-4 w-4" />
          {resetMany.isPending ? "Resetting..." : `Reset all open${notClosed.length > 0 ? ` (${notClosed.length})` : ""}`}
        </Button>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      {data?.instance_id && (
        <p className="text-xs text-muted-foreground">
          Breaker state is per-replica, never cluster-wide — this is node{" "}
          <span className="font-mono">{data.instance_id}</span>. Other replicas keep their own map.
        </p>
      )}

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : data && !data.enabled ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Circuit breakers are disabled on this engine.
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No circuit breaker activity recorded yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge variant="outline" className={breakerStateBadgeClass("open")}>{counts.open} open</Badge>
            <Badge variant="outline" className={breakerStateBadgeClass("half_open")}>{counts.half_open} half-open</Badge>
            <Badge variant="outline" className={breakerStateBadgeClass("closed")}>{counts.closed} closed</Badge>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Connector</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const connId = connectorIdByName.get(row.connector)
                  const chanId = channelIdByName.get(row.channel)
                  const isTarget = highlighted === row.key
                  return (
                    <TableRow
                      key={row.key}
                      className={cn(isTarget && "bg-accent")}
                      ref={(el) => {
                        if (el && isTarget && !scrolled.current) {
                          scrolled.current = true
                          el.scrollIntoView({ block: "center" })
                        }
                      }}
                    >
                      <TableCell className="font-medium">
                        {chanId ? (
                          <Link to={`/channels/${chanId}`} className="hover:underline">
                            {row.channel}
                          </Link>
                        ) : (
                          row.channel
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {connId ? (
                          <Link to={`/connectors/${connId}`} className="text-primary hover:underline">
                            {row.connector}
                          </Link>
                        ) : (
                          row.connector
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={breakerStateBadgeClass(row.state)}>
                          {row.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={reset.isPending || resetMany.isPending || row.state === "closed"}
                          onClick={() => reset.mutate(row.key)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Reset
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {confirmAll && (
        <ConfirmDialog
          title={`Reset ${notClosed.length} circuit ${notClosed.length === 1 ? "breaker" : "breakers"}`}
          description={`Every open or half-open breaker on this node closes and its connector is called again on the next request. If the backend is still down the breakers reopen after the failure threshold. Other replicas keep their own state. Keys: ${notClosed
            .slice(0, 8)
            .map((r) => r.key)
            .join(", ")}${notClosed.length > 8 ? ` and ${notClosed.length - 8} more` : ""}.`}
          onConfirm={() => {
            setConfirmAll(false)
            resetMany.mutate(notClosed.map((r) => r.key))
          }}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  )
}
