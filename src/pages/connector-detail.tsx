import { useParams, Link } from "react-router"
import { useConnector } from "@/hooks/use-connectors"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { ArrowLeft } from "lucide-react"

function maskValue(value: unknown): string {
  if (typeof value === "string" && value.length > 4) {
    return value.slice(0, 2) + "***" + value.slice(-2)
  }
  return String(value)
}

function renderConfig(configJson: string) {
  let config: Record<string, unknown>
  try {
    config = JSON.parse(configJson)
  } catch {
    return <p className="font-mono text-sm text-muted-foreground">{configJson || "No configuration"}</p>
  }

  if (Object.keys(config).length === 0) {
    return <p className="text-muted-foreground">No configuration</p>
  }

  return Object.entries(config).map(([key, value]) => {
    const isSensitive = /password|secret|token|key|auth/i.test(key)
    const displayValue = isSensitive ? maskValue(value) : JSON.stringify(value)
    return (
      <div key={key} className="flex justify-between border-b py-2 last:border-0">
        <span className="font-mono text-sm text-muted-foreground">{key}</span>
        <span className="font-mono text-sm">{displayValue}</span>
      </div>
    )
  })
}

export function ConnectorDetailPage() {
  const { id } = useParams()
  const { data: connector, isLoading, error } = useConnector(id ?? "")

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
        <p className="text-destructive">Failed to load connector: {error?.message ?? "Not found"}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/connectors"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Connectors</Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{connector.name}</h1>
        <Badge variant="outline" className="uppercase">{connector.connector_type}</Badge>
        <Badge variant={connector.enabled ? "default" : "secondary"} className={connector.enabled ? "bg-emerald-500" : ""}>
          {connector.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <div className="text-sm text-muted-foreground">
        <span>Created: {formatDate(connector.created_at)}</span>
        <span className="ml-4">Updated: {formatDate(connector.updated_at)}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          {renderConfig(connector.config_json)}
        </CardContent>
      </Card>
    </div>
  )
}
