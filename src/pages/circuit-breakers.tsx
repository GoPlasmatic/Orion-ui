import { useMemo } from "react"
import { Link } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useCircuitBreakers, useResetCircuitBreaker, useConnectors } from "@/hooks/use-connectors"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { breakerStateBadgeClass } from "@/lib/status"
import { RefreshCw } from "lucide-react"

interface BreakerRow {
  key: string
  channel: string
  connector: string
  state: string
}

export function CircuitBreakersPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useCircuitBreakers({ refetchInterval: 15_000 })
  const { data: connectors } = useConnectors({ limit: 1000 })
  const reset = useResetCircuitBreaker()

  const connectorIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of connectors?.data ?? []) m.set(c.name, c.id)
    return m
  }, [connectors?.data])

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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })

  return (
    <div className="space-y-6">
      <PageHeader title="Circuit Breakers" description="Connector breaker states across the fleet">
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
                  return (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.channel}</TableCell>
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
                          disabled={reset.isPending || row.state === "closed"}
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
    </div>
  )
}
