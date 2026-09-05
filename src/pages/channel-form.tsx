import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import {
  useChannel,
  useCreateChannel,
  useUpdateChannel,
  useValidateChannel,
} from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
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
import { useUnsavedChanges } from "@/lib/use-unsaved-changes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/shared/page-header"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { FormError } from "@/components/shared/form-error"
import { TagsInput } from "@/components/shared/tags-input"
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog"
import { ValidationResults } from "@/components/shared/validation-results"
import { ChannelConfigEditor } from "@/components/shared/channel-config-editor"
import { CronTransportEditor } from "@/components/shared/cron-transport-editor"
import { Save, ShieldCheck } from "lucide-react"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"

const CHANNEL_TYPES: ChannelType[] = ["sync", "async"]
// `cron` (1.6) is the fourth protocol: started by a clock, not a caller.
const PROTOCOLS: ChannelProtocol[] = ["rest", "http", "kafka", "cron"]
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

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
  // The picker's options. A workflow is bound by its slug id, which nobody
  // should have to remember or retype.
  const { data: workflowList } = useWorkflows({ limit: REGISTRY_LIMIT })

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
  const [methods, setMethods] = useState<string[]>(() =>
    (existing?.methods ?? []).map((m) => m.toUpperCase())
  )
  const [routePattern, setRoutePattern] = useState(existing?.route_pattern ?? "")
  const [topic, setTopic] = useState(existing?.topic ?? "")
  const [consumerGroup, setConsumerGroup] = useState(existing?.consumer_group ?? "")
  const [workflowId, setWorkflowId] = useState(existing?.workflow_id ?? "")
  const [priority, setPriority] = useState(String(existing?.priority ?? 0))
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [config, setConfig] = useState<ChannelConfig>(existing?.config ?? {})
  const [transportConfig, setTransportConfig] = useState(() => {
    const tc = existing?.transport_config
    return tc && Object.keys(tc).length > 0 ? JSON.stringify(tc, null, 2) : ""
  })
  const [transportError, setTransportError] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState<ValidationResponse | null>(null)

  // Everything the payload is built from, as one string, so "has anything
  // changed since the form opened" is one comparison.
  const snapshot = JSON.stringify({
    name, description, channelType, protocol, cron, methods, routePattern, topic,
    consumerGroup, workflowId, priority, tags, config, transportConfig,
  })
  const [initialSnapshot] = useState(snapshot)
  const { blocker, markSaved } = useUnsavedChanges(snapshot !== initialSnapshot)

  const backTo = existing ? `/channels/${existing.channel_id}` : "/channels"
  const isCron = protocol === "cron"
  const workflows = workflowList?.data ?? []
  const workflowKnown = !workflowId || workflows.some((w) => w.workflow_id === workflowId)

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
      setMethods([])
      setRoutePattern("")
      setTopic("")
      setConsumerGroup("")
    }
  }

  const toggleMethod = (method: string, on: boolean) =>
    setMethods((prev) => {
      const without = prev.filter((m) => m !== method)
      return on ? HTTP_METHODS.filter((m) => m === method || without.includes(m)) : without
    })

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
      methods: !isCron && methods.length > 0 ? methods : undefined,
      route_pattern: !isCron && routePattern ? routePattern : undefined,
      topic: !isCron && topic ? topic : undefined,
      consumer_group: !isCron && consumerGroup ? consumerGroup : undefined,
      transport_config: transport,
      workflow_id: workflowId || undefined,
      config: isCron ? stripCronRefusedConfig(config) : config,
      priority: Number(priority) || 0,
      channel_type: isCron ? "async" : channelType,
      protocol,
      tags,
    }
  }

  const handleValidate = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    validateChannel.mutate(payload, {
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
        tags: payload.tags,
      }
      updateChannel.mutate(
        { id: existing.channel_id, req },
        {
          onSuccess: () => {
            markSaved()
            navigate(`/channels/${existing.channel_id}`)
          },
          onError: setError,
        }
      )
    } else {
      createChannel.mutate(payload, {
        onSuccess: (c) => {
          markSaved()
          navigate(`/channels/${c.channel_id}`)
        },
        onError: setError,
      })
    }
  }

  const isPending = createChannel.isPending || updateChannel.isPending

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Channels", to: "/channels" },
          ...(existing ? [{ label: existing.name, to: backTo }] : []),
          { label: isEdit ? "Edit" : isCron ? "New cron channel" : "New channel" },
        ]}
      />

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
            <Label required>Name</Label>
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
              <Label
                hint={
                  isCron
                    ? "A cron channel is always async"
                    : isEdit
                      ? "Fixed after create"
                      : "Fixed after create — a new channel is needed to change it"
                }
              >
                Type
              </Label>
              {isEdit || isCron ? (
                <div className="pt-1"><Badge variant="outline">{channelType}</Badge></div>
              ) : (
                <Select value={channelType} onChange={(e) => setChannelType(e.target.value as ChannelType)} aria-label="Channel type">
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              )}
            </div>
            <div>
              <Label hint={isEdit ? "Fixed after create" : "Fixed after create"}>Protocol</Label>
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

          {!isCron && (
            <>
              <div>
                <Label hint="Which verbs the route answers; a REST channel needs at least one.">
                  Methods
                </Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1" role="group" aria-label="HTTP methods">
                  {HTTP_METHODS.map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-1.5 font-mono text-sm">
                      <Checkbox
                        checked={methods.includes(m)}
                        onCheckedChange={(on) => toggleMethod(m, on)}
                        aria-label={m}
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label hint="Matched byte-exactly; {param} segments become metadata.">
                  Route Pattern
                </Label>
                <Input
                  value={routePattern}
                  onChange={(e) => setRoutePattern(e.target.value)}
                  placeholder="/api/v1/orders"
                  aria-label="Route pattern"
                  className="font-mono"
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label hint="Higher wins when two channels match the same request.">Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority" />
            </div>
            <div>
              <Label hint="Filters the list, the map and the export.">Tags</Label>
              <TagsInput value={tags} onChange={setTags} placeholder="orders, billing" aria-label="Tags" />
            </div>
          </div>

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
              hint={
                isCron
                  ? "The workflow the schedule runs; the payload arrives where a request body would."
                  : "What the channel runs. Activating the channel needs this workflow active."
              }
            >
              Linked workflow
            </Label>
            <Select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              aria-label="Linked workflow"
            >
              <option value="">{isCron ? "Choose a workflow" : "None yet"}</option>
              {!workflowKnown && (
                <option value={workflowId}>{workflowId} · not in the list</option>
              )}
              {(["active", "draft", "archived"] as const).map((status) => {
                const group = workflows.filter((w) => w.status === status)
                if (group.length === 0) return null
                return (
                  <optgroup key={status} label={status}>
                    {group.map((w) => (
                      <option key={w.workflow_id} value={w.workflow_id}>
                        {w.name} · {w.workflow_id}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </Select>
          </div>

          <ChannelConfigEditor value={config} onChange={setConfig} protocol={protocol} />

          {validation && <ValidationResults result={validation} validLabel="Channel is valid." />}

          <FormError error={error} />

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
              {isPending ? "Saving..." : isEdit ? "Save Draft" : "Create Draft"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <UnsavedChangesDialog blocker={blocker} />
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
