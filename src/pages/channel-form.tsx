import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
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
  CronTransportConfig,
  UpdateChannelRequest,
  ValidationResponse,
} from "@/api/types"
import { cronTransport, stripCronRefusedConfig } from "@/lib/cron"
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
import { CronTransportEditor } from "@/components/shared/cron-transport-editor"
import { ArrowLeft, Save, ShieldCheck } from "lucide-react"

const CHANNEL_TYPES: ChannelType[] = ["sync", "async"]
// `cron` (1.6) is the fourth protocol: started by a clock, not a caller.
const PROTOCOLS: ChannelProtocol[] = ["rest", "http", "kafka", "cron"]

const isProtocol = (v: string | null): v is ChannelProtocol =>
  v !== null && (PROTOCOLS as string[]).includes(v)

/** A schedule to start from, so the cron form is never an empty JSON box. */
const CRON_STARTER: CronTransportConfig = { schedule: "0 0 2 * * *", timezone: "UTC" }

function ChannelForm({
  existing,
  initialProtocol,
}: {
  existing?: Channel
  /** Preselects the protocol on create — the Schedules page links here with `?protocol=cron`. */
  initialProtocol?: ChannelProtocol
}) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const validateChannel = useValidateChannel()

  const startProtocol = existing?.protocol ?? initialProtocol ?? "rest"
  const [name, setName] = useState(existing?.name ?? "")
  const [description, setDescription] = useState(existing?.description ?? "")
  // A cron channel must be async: its work is a claimed occurrence, never a
  // waiting caller.
  const [channelType, setChannelType] = useState<ChannelType>(
    existing?.channel_type ?? (startProtocol === "cron" ? "async" : "sync")
  )
  const [protocol, setProtocol] = useState<ChannelProtocol>(startProtocol)
  const [cron, setCron] = useState<CronTransportConfig>(
    () => cronTransport(existing) ?? CRON_STARTER
  )
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
  const isCron = protocol === "cron"

  /**
   * Switching to cron on a draft: the caller-shaped fields have no meaning and
   * are refused at save, so drop them here rather than let the first Save be
   * a 400. The other direction keeps everything — a route can be typed back.
   */
  const changeProtocol = (next: ChannelProtocol) => {
    setProtocol(next)
    if (next === "cron") {
      setChannelType("async")
      setConfig((c) => stripCronRefusedConfig(c))
      setMethods("")
      setRoutePattern("")
      setTopic("")
      setConsumerGroup("")
    }
  }

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
    if (isCron) {
      if (!cron.schedule?.trim()) {
        setError("A cron channel needs a schedule")
        return null
      }
      transport = cron as unknown as Record<string, unknown>
    } else if (transportConfig.trim()) {
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
      // A cron channel registers no route and no subscription; each of these
      // is refused there rather than ignored.
      methods: !isCron && methodList.length > 0 ? methodList : undefined,
      route_pattern: !isCron && routePattern ? routePattern : undefined,
      topic: !isCron && topic ? topic : undefined,
      consumer_group: !isCron && consumerGroup ? consumerGroup : undefined,
      transport_config: transport,
      workflow_id: workflowId || undefined,
      config: isCron ? stripCronRefusedConfig(config) : config,
      priority: Number(priority) || 0,
      channel_type: isCron ? "async" : channelType,
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
        title={isEdit ? "Edit Channel" : isCron ? "Create Cron Channel" : "Create Channel"}
        description={
          isCron
            ? "A workflow run on a schedule — started by a clock, not a caller"
            : "Service endpoint and routing configuration"
        }
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
              <Label hint={isCron ? "A cron channel is always async" : undefined}>Type</Label>
              {isEdit || isCron ? (
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
                <Select
                  value={protocol}
                  onChange={(e) => changeProtocol(e.target.value as ChannelProtocol)}
                  aria-label="Protocol"
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>{p.toUpperCase()}</option>
                  ))}
                </Select>
              )}
            </div>
          </div>

          {isCron ? (
            <div>
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          ) : (
            <>
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
            </>
          )}

          {isCron && <CronTransportEditor value={cron} onChange={setCron} />}

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

          {!isCron && (protocol === "kafka" || transportConfig.trim() !== "") && (
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
            <Label
              required={isCron}
              hint={isCron ? "The workflow the schedule runs; the payload arrives where a request body would." : undefined}
            >
              Linked Workflow ID
            </Label>
            <Input
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              aria-label="Linked workflow ID"
            />
          </div>

          <ChannelConfigEditor value={config} onChange={setConfig} protocol={protocol} />

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
  const [params] = useSearchParams()
  const requested = params.get("protocol")
  const initialProtocol = isProtocol(requested) ? requested : undefined
  const { data: existing, isLoading } = useChannel(id ?? "")

  if (id && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full max-w-2xl" />
      </div>
    )
  }

  return (
    <ChannelForm
      key={existing?.channel_id ?? `new-${initialProtocol ?? "rest"}`}
      existing={id ? existing : undefined}
      initialProtocol={initialProtocol}
    />
  )
}
