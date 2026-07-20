import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useConnector, useCreateConnector, useUpdateConnector } from "@/hooks/use-connectors"
import type { Connector, ConnectorType } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { ConnectorConfigEditor } from "@/components/shared/connector-config-editor"
import { parseJson } from "@/lib/utils"
import { ArrowLeft, Save } from "lucide-react"

function initialConfig(existing?: Connector): Record<string, unknown> {
  if (!existing) return {}
  const parsed = parseJson(existing.config_json)
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

const CONNECTOR_TYPES: ConnectorType[] = ["http", "kafka", "db", "cache", "storage", "es"]

function ConnectorForm({ existing }: { existing?: Connector }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createConnector = useCreateConnector()
  const updateConnector = useUpdateConnector()

  const [name, setName] = useState(existing?.name ?? "")
  const [type, setType] = useState<ConnectorType>(existing?.connector_type ?? "http")
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [config, setConfig] = useState<Record<string, unknown>>(() => initialConfig(existing))
  const [error, setError] = useState<string | null>(null)

  const backTo = existing ? `/connectors/${existing.id}` : "/connectors"

  const handleSubmit = () => {
    setError(null)
    if (!name.trim()) {
      setError("Name is required")
      return
    }

    if (existing) {
      updateConnector.mutate(
        { id: existing.id, req: { name, connector_type: type, config, enabled } },
        {
          onSuccess: () => navigate(`/connectors/${existing.id}`),
          onError: (e) => setError(e instanceof Error ? e.message : "Update failed"),
        }
      )
    } else {
      createConnector.mutate(
        { name, connector_type: type, config },
        {
          onSuccess: (c) => navigate(`/connectors/${c.id}`),
          onError: (e) => setError(e instanceof Error ? e.message : "Create failed"),
        }
      )
    }
  }

  const isPending = createConnector.isPending || updateConnector.isPending

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to={backTo}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? "Edit Connector" : "Create Connector"}
        description="External system connection configuration"
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Connector</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-connector" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <Select value={type} onChange={(e) => setType(e.target.value as ConnectorType)}>
              {CONNECTOR_TYPES.map((t) => (
                <option key={t} value={t}>{t.toUpperCase()}</option>
              ))}
            </Select>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" />
              Enabled
            </div>
          )}

          <ConnectorConfigEditor connectorType={type} value={config} onChange={setConfig} />

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              <Save className="h-4 w-4" />
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function ConnectorFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data: existing, isLoading } = useConnector(id ?? "")

  if (id && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full max-w-2xl" />
      </div>
    )
  }

  // Remount with fresh initial state once the connector resolves (or immediately for create).
  return <ConnectorForm key={existing?.id ?? "new"} existing={id ? existing : undefined} />
}
