import { useParams, Link, useNavigate, useSearchParams } from "react-router"
import {
  useConnector,
  useConnectors,
  useDeleteConnector,
  useCircuitBreakers,
  useResetCircuitBreaker,
} from "@/hooks/use-connectors"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { JsonViewer } from "@/components/shared/json-viewer"
import { NeighbourhoodMap } from "@/components/graph/neighbourhood-map"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { ConnectorTestDialog } from "@/components/shared/connector-test-dialog"
import { ErrorState } from "@/components/shared/error-state"
import { formatDate } from "@/lib/utils"
import { enabledBadgeClass, disabledBadgeClass, breakerStateBadgeClass } from "@/lib/status"
import { Trash2, RefreshCw, Pencil, Activity } from "lucide-react"
import { useMemo, useState } from "react"

export function ConnectorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: connector, isLoading, error, refetch } = useConnector(id ?? "")
  const { data: circuitBreakers } = useCircuitBreakers()
  const deleteConnector = useDeleteConnector()
  const resetBreaker = useResetCircuitBreaker()
  const [params] = useSearchParams()
  // Who depends on it, for the delete dialog: the server refuses with 409,
  // but the question deserves an answer before the click.
  const { data: channelList } = useChannels({ limit: 1000 })
  const { data: workflowList } = useWorkflows({ limit: 1000 })
  const { data: connectorList } = useConnectors({ limit: 1000 })
  const users = useMemo(() => {
    if (!connector) return []
    const graph = buildSystemGraph(
      buildIndex(channelList?.data ?? [], workflowList?.data ?? [], connectorList?.data ?? []),
    )
    return graph.connectors.find((c) => c.name === connector.name)?.users ?? []
  }, [connector, channelList?.data, workflowList?.data, connectorList?.data])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // `?test=1` opens the probe straight away — the dashboard's "connector
  // failed to load" alert lands here, and the probe is the first thing to run.
  const [showTest, setShowTest] = useState(() => params.get("test") === "1")

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (error || !connector) {
    return (
      <ErrorState
        title="Failed to load connector"
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/connectors", label: "Back to Connectors" }}
      />
    )
  }

  // Keys are `channel:connector`. Match the connector segment exactly: a
  // substring test matched connector `db` against `orders:db-replica`.
  const connectorBreakers = Object.entries(circuitBreakers?.breakers ?? {}).filter(([key]) => {
    const sep = key.indexOf(":")
    return (sep === -1 ? key : key.slice(sep + 1)) === connector.name
  })

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Connectors", to: "/connectors" }, { label: connector.name }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-2xl font-bold">{connector.name}</h1>
          <Badge variant="outline" className="uppercase">{connector.connector_type}</Badge>
          <Badge
            variant="outline"
            className={connector.enabled ? enabledBadgeClass : disabledBadgeClass}
          >
            {connector.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTest(true)}
          >
            <Activity className="h-3.5 w-3.5" />
            Test
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/connectors/${connector.id}/edit`}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleteConnector.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        <span>Created: {formatDate(connector.created_at)}</span>
        <span className="ml-4">Updated: {formatDate(connector.updated_at)}</span>
        <span className="ml-4">
          Used by {users.length} channel{users.length === 1 ? "" : "s"}
        </span>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="circuit-breaker">Circuit Breaker</TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <div className="space-y-4">
            <ConfigSummary config={connector.config} />
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Secret fields (passwords, tokens, API keys) are masked by the server.
              </p>
              <JsonViewer
                data={connector.config}
                label="Connector Configuration"
                maxHeight="32rem"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="relationships">
          <NeighbourhoodMap kind="connector" id={connector.name} />
        </TabsContent>

        <TabsContent value="circuit-breaker">
          {circuitBreakers && !circuitBreakers.enabled ? (
            <p className="text-sm text-muted-foreground py-4">
              Circuit breakers are disabled on this engine.
            </p>
          ) : connectorBreakers.length > 0 ? (
            <div className="space-y-3">
              {connectorBreakers.map(([key, state]) => (
                <Card key={key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">{key}</CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetBreaker.mutate(key)}
                        disabled={resetBreaker.isPending}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reset
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">State</span>
                      <Badge variant="outline" className={breakerStateBadgeClass(state)}>
                        {state}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              No circuit breaker data available for this connector.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {showTest && (
        <ConnectorTestDialog connector={connector} onClose={() => setShowTest(false)} />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Connector"
          description={
            users.length > 0
              ? `"${connector.name}" is referenced by ${users.length} channel${users.length === 1 ? "" : "s"} (${users.slice(0, 5).join(", ")}${users.length > 5 ? ", …" : ""}). The server refuses the delete while an active workflow uses it; a draft one will start failing. This cannot be undone.`
              : `Are you sure you want to delete "${connector.name}"? This action cannot be undone.`
          }
          destructive
          onConfirm={() => {
            deleteConnector.mutate(connector.id, {
              onSuccess: () => navigate("/connectors"),
            })
            setShowDeleteConfirm(false)
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}


/** A masked secret, as the server returns it. */
const MASK = "******"

/**
 * The configuration as a table rather than a JSON tree: every top-level field
 * with its value, the way the form presents it. A nested object is shown as
 * one compact line and a masked secret as "secret", so the page answers
 * "which host, which database, which timeout" without reading braces.
 */
function ConfigSummary({ config }: { config: Record<string, unknown> }) {
  const entries = Object.entries(config ?? {})
  if (entries.length === 0) return null
  const render = (value: unknown): { text: string; muted?: boolean } => {
    if (value === MASK) return { text: "secret (masked)", muted: true }
    if (value === null || value === undefined) return { text: "—", muted: true }
    if (typeof value === "string") return { text: value }
    if (typeof value === "number" || typeof value === "boolean") return { text: String(value) }
    if (Array.isArray(value)) {
      const compact = JSON.stringify(value)
      return { text: compact.length > 80 ? `${value.length} items` : compact }
    }
    const compact = JSON.stringify(value)
    return { text: compact.length > 80 ? `${Object.keys(value as object).length} fields` : compact }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([key, value]) => {
            const { text, muted } = render(value)
            return (
              <div key={key} className="min-w-0">
                <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
                <dd
                  className={`truncate ${muted ? "text-muted-foreground" : "font-mono text-xs"}`}
                  title={muted ? undefined : text}
                >
                  {text}
                </dd>
              </div>
            )
          })}
        </dl>
      </CardContent>
    </Card>
  )
}
