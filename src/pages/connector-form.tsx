import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import {
  useConnector,
  useCreateConnector,
  useUpdateConnector,
  useValidateConnector,
} from "@/hooks/use-connectors"
import type {
  Connector,
  ConnectorType,
  CreateConnectorRequest,
  ValidationResponse,
} from "@/api/types"
import { useUnsavedChanges } from "@/lib/use-unsaved-changes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/shared/page-header"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { FormError } from "@/components/shared/form-error"
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog"
import { ConnectorConfigEditor } from "@/components/shared/connector-config-editor"
import { ValidationResults } from "@/components/shared/validation-results"
import { Save, ShieldCheck } from "lucide-react"

// The server returns `config` already parsed, in the shape POST/PUT accept, so
// a read round-trips straight back. `config_json` is the same document as a
// string and needs no second parse.
function initialConfig(existing?: Connector): Record<string, unknown> {
  const cfg = existing?.config
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {}
}

const CONNECTOR_TYPES: ConnectorType[] = ["http", "kafka", "db", "cache", "storage", "es", "smtp"]

function ConnectorForm({ existing }: { existing?: Connector }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createConnector = useCreateConnector()
  const updateConnector = useUpdateConnector()
  const validateConnector = useValidateConnector()

  const [name, setName] = useState(existing?.name ?? "")
  const [type, setType] = useState<ConnectorType>(existing?.connector_type ?? "http")
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [config, setConfig] = useState<Record<string, unknown>>(() => initialConfig(existing))
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState<ValidationResponse | null>(null)

  const snapshot = JSON.stringify({ name, type, enabled, config })
  const [initialSnapshot] = useState(snapshot)
  const { blocker, markSaved } = useUnsavedChanges(snapshot !== initialSnapshot)

  const backTo = existing ? `/connectors/${existing.id}` : "/connectors"

  /**
   * Shared by Save and Validate so Validate checks exactly what Save sends.
   * `validate` runs the same validator `POST admin/connectors` runs, which is
   * where grant-conditional rules (oauth2) and per-type field requirements are
   * adjudicated — the client does not re-implement them.
   */
  const buildPayload = (): CreateConnectorRequest | null => {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }
    return { name, connector_type: type, config }
  }

  const handleValidate = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    validateConnector.mutate(payload, {
      onSuccess: setValidation,
      onError: setError,
    })
  }

  const handleSubmit = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return

    if (existing) {
      updateConnector.mutate(
        { id: existing.id, req: { ...payload, enabled } },
        {
          onSuccess: () => {
            markSaved()
            navigate(`/connectors/${existing.id}`)
          },
          onError: setError,
        }
      )
    } else {
      createConnector.mutate(payload, {
        onSuccess: (c) => {
          markSaved()
          navigate(`/connectors/${c.id}`)
        },
        onError: setError,
      })
    }
  }

  const isPending = createConnector.isPending || updateConnector.isPending

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Connectors", to: "/connectors" },
          ...(existing ? [{ label: existing.name, to: backTo }] : []),
          { label: isEdit ? "Edit" : "New connector" },
        ]}
      />

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
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-connector" />
          </div>

          <div>
            <Label>Type</Label>
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

          {validation && <ValidationResults result={validation} validLabel="Connector is valid." />}

          <FormError error={error} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={validateConnector.isPending}
            >
              <ShieldCheck className="h-4 w-4" />
              {validateConnector.isPending ? "Validating..." : "Validate"}
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              <Save className="h-4 w-4" />
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <UnsavedChangesDialog blocker={blocker} />
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
