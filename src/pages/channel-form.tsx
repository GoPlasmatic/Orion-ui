import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import {
  useChannel,
  useCreateChannel,
  useUpdateChannel,
  useValidateChannel,
} from "@/hooks/use-channels"
import type {
  Channel,
  ChannelConfig,
  ChannelProtocol,
  ChannelType,
  CreateChannelRequest,
  UpdateChannelRequest,
  ValidationResponse,
} from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import { PageHeader } from "@/components/shared/page-header"
import { ValidationResults } from "@/components/shared/validation-results"
import { ChannelConfigEditor } from "@/components/shared/channel-config-editor"
import { ArrowLeft, Save, ShieldCheck } from "lucide-react"

const CHANNEL_TYPES: ChannelType[] = ["sync", "async"]
const PROTOCOLS: ChannelProtocol[] = ["rest", "http", "kafka"]

function ChannelForm({ existing }: { existing?: Channel }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const validateChannel = useValidateChannel()

  const [name, setName] = useState(existing?.name ?? "")
  const [description, setDescription] = useState(existing?.description ?? "")
  const [channelType, setChannelType] = useState<ChannelType>(existing?.channel_type ?? "sync")
  const [protocol, setProtocol] = useState<ChannelProtocol>(existing?.protocol ?? "rest")
  const [methods, setMethods] = useState((existing?.methods ?? []).join(", "))
  const [routePattern, setRoutePattern] = useState(existing?.route_pattern ?? "")
  const [topic, setTopic] = useState(existing?.topic ?? "")
  const [consumerGroup, setConsumerGroup] = useState(existing?.consumer_group ?? "")
  const [workflowId, setWorkflowId] = useState(existing?.workflow_id ?? "")
  const [priority, setPriority] = useState(String(existing?.priority ?? 0))
  const [config, setConfig] = useState<ChannelConfig>(existing?.config ?? {})
  const [transportConfig, setTransportConfig] = useState(() => {
    const tc = existing?.transport_config
    return tc && Object.keys(tc).length > 0 ? JSON.stringify(tc, null, 2) : ""
  })
  const [transportError, setTransportError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationResponse | null>(null)

  const backTo = existing ? `/channels/${existing.channel_id}` : "/channels"

  /**
   * Assemble the request, or return null after setting `error`. Shared by Save
   * and Validate so Validate checks exactly what Save would send — a validator
   * run against a different payload is worse than no validator.
   */
  const buildPayload = (): CreateChannelRequest | null => {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }

    const methodList = methods
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)

    let transport: Record<string, unknown> | undefined
    if (transportConfig.trim()) {
      try {
        const parsed = JSON.parse(transportConfig)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setError("Transport config must be a JSON object")
          return null
        }
        transport = parsed as Record<string, unknown>
      } catch {
        setError("Transport config is not valid JSON")
        return null
      }
    }

    return {
      name,
      description: description || undefined,
      methods: methodList.length > 0 ? methodList : undefined,
      route_pattern: routePattern || undefined,
      topic: topic || undefined,
      consumer_group: consumerGroup || undefined,
      transport_config: transport,
      workflow_id: workflowId || undefined,
      config,
      priority: Number(priority) || 0,
      channel_type: channelType,
      protocol,
    }
  }

  const handleValidate = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    validateChannel.mutate(payload, {
      onSuccess: setValidation,
      onError: (e) => setError(e instanceof Error ? e.message : "Validation failed"),
    })
  }

  const handleSubmit = () => {
    setError(null)
    setValidation(null)

    const payload = buildPayload()
    if (!payload) return

    if (existing) {
      // channel_type and protocol are immutable after create, so an update
      // sends only the mutable subset.
      const req: UpdateChannelRequest = {
        name: payload.name,
        description: payload.description,
        methods: payload.methods,
        route_pattern: payload.route_pattern,
        topic: payload.topic,
        consumer_group: payload.consumer_group,
        transport_config: payload.transport_config,
        workflow_id: payload.workflow_id,
        config: payload.config,
        priority: payload.priority,
      }
      updateChannel.mutate(
        { id: existing.channel_id, req },
        {
          onSuccess: () => navigate(`/channels/${existing.channel_id}`),
          onError: (e) => setError(e instanceof Error ? e.message : "Update failed"),
        }
      )
    } else {
      createChannel.mutate(payload, {
        onSuccess: (c) => navigate(`/channels/${c.channel_id}`),
        onError: (e) => setError(e instanceof Error ? e.message : "Create failed"),
      })
    }
  }

  const isPending = createChannel.isPending || updateChannel.isPending

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to={backTo}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? "Edit Channel" : "Create Channel"}
        description="Service endpoint and routing configuration"
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Channel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="orders"
              aria-label="Channel name"
            />
          </div>

          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type</Label>
              {isEdit ? (
                <div className="pt-1"><Badge variant="outline">{channelType}</Badge></div>
              ) : (
                <Select value={channelType} onChange={(e) => setChannelType(e.target.value as ChannelType)}>
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              )}
            </div>
            <div>
              <Label>Protocol</Label>
              {isEdit ? (
                <div className="pt-1"><Badge variant="outline" className="uppercase">{protocol}</Badge></div>
              ) : (
                <Select value={protocol} onChange={(e) => setProtocol(e.target.value as ChannelProtocol)}>
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>{p.toUpperCase()}</option>
                  ))}
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Methods</Label>
              <Input
                value={methods}
                onChange={(e) => setMethods(e.target.value)}
                placeholder="GET, POST"
                aria-label="HTTP methods"
              />
            </div>
            <div>
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Route Pattern</Label>
            <Input
              value={routePattern}
              onChange={(e) => setRoutePattern(e.target.value)}
              placeholder="/api/v1/orders"
              aria-label="Route pattern"
            />
          </div>

          {protocol === "kafka" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Topic</Label>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="orders-in" />
              </div>
              <div>
                <Label>Consumer Group</Label>
                <Input value={consumerGroup} onChange={(e) => setConsumerGroup(e.target.value)} placeholder="orion" />
              </div>
            </div>
          )}

          {(protocol === "kafka" || transportConfig.trim() !== "") && (
            <div>
              <Label>Transport Config</Label>
              <p className="mb-1 text-xs text-muted-foreground">
                Protocol-specific transport settings as JSON
                {protocol === "kafka" ? " (e.g. brokers, offsets, security)" : ""}. Leave empty to keep unset.
              </p>
              <Textarea
                value={transportConfig}
                onChange={(e) => {
                  setTransportConfig(e.target.value)
                  if (!e.target.value.trim()) {
                    setTransportError(null)
                    return
                  }
                  try {
                    JSON.parse(e.target.value)
                    setTransportError(null)
                  } catch {
                    setTransportError("Invalid JSON")
                  }
                }}
                rows={5}
                className="font-mono text-xs"
                placeholder='{ "brokers": ["kafka:9092"] }'
              />
              {transportError && <p className="mt-1 text-xs text-destructive">{transportError}</p>}
            </div>
          )}

          <div>
            <Label>Linked Workflow ID</Label>
            <Input
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              aria-label="Linked workflow ID"
            />
          </div>

          <ChannelConfigEditor value={config} onChange={setConfig} />

          {validation && <ValidationResults result={validation} validLabel="Channel is valid." />}

          {error && (
            <Callout variant="destructive">
              {error}
            </Callout>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button variant="outline" onClick={handleValidate} disabled={validateChannel.isPending}>
              <ShieldCheck className="h-4 w-4" />
              {validateChannel.isPending ? "Validating..." : "Validate"}
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

export function ChannelFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data: existing, isLoading } = useChannel(id ?? "")

  if (id && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full max-w-2xl" />
      </div>
    )
  }

  return <ChannelForm key={existing?.channel_id ?? "new"} existing={id ? existing : undefined} />
}
