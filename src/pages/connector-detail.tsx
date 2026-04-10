import { useParams, Link, useNavigate } from "react-router"
import { useConnector, useDeleteConnector, useCircuitBreakers, useResetCircuitBreaker } from "@/hooks/use-connectors"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { JsonViewer } from "@/components/shared/json-viewer"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { formatDate } from "@/lib/utils"
import { ArrowLeft, AlertCircle, Trash2, RefreshCw } from "lucide-react"
import { useState } from "react"

export function ConnectorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: connector, isLoading, error } = useConnector(id ?? "")
  const { data: circuitBreakers } = useCircuitBreakers()
  const deleteConnector = useDeleteConnector()
  const resetBreaker = useResetCircuitBreaker()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link to="/connectors"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Connectors</Link>
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load connector.</p>
        </div>
      </div>
    )
  }

  const connectorBreakers = circuitBreakers?.filter((cb) =>
    cb.key.includes(connector.name)
  ) ?? []

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/connectors"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Connectors</Link>
      </Button>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{connector.name}</h1>
          <Badge variant="outline" className="uppercase">{connector.connector_type}</Badge>
        </div>
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

      <div className="text-sm text-muted-foreground">
        <span>Created: {formatDate(connector.created_at)}</span>
        <span className="ml-4">Updated: {formatDate(connector.updated_at)}</span>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="circuit-breaker">Circuit Breaker</TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <JsonViewer data={connector.config} label="Connector Configuration" maxHeight="32rem" />
        </TabsContent>

        <TabsContent value="circuit-breaker">
          {connectorBreakers.length > 0 ? (
            <div className="space-y-3">
              {connectorBreakers.map((cb) => (
                <Card key={cb.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">{cb.key}</CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetBreaker.mutate(cb.key)}
                        disabled={resetBreaker.isPending}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reset
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">State</span>
                        <Badge
                          variant="outline"
                          className={
                            cb.state === "closed"
                              ? "border-emerald-200 text-emerald-700"
                              : cb.state === "open"
                                ? "border-red-200 text-red-700"
                                : "border-amber-200 text-amber-700"
                          }
                        >
                          {cb.state}
                        </Badge>
                      </div>
                      {cb.failure_count !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Failures</span>
                          <span>{cb.failure_count}</span>
                        </div>
                      )}
                      {cb.last_failure && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last Failure</span>
                          <span>{formatDate(cb.last_failure)}</span>
                        </div>
                      )}
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

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Connector"
          description={`Are you sure you want to delete "${connector.name}"? This action cannot be undone.`}
          destructive
          onConfirm={() => {
            deleteConnector.mutate(connector.name, {
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
