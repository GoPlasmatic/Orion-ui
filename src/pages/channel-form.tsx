import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useChannel, useCreateChannel, useUpdateChannel } from "@/hooks/use-channels"
import type {
  Channel,
  ChannelConfig,
  ChannelProtocol,
  ChannelType,
  CreateChannelRequest,
  UpdateChannelRequest,
} from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { ChannelConfigEditor } from "@/components/shared/channel-config-editor"
import { ArrowLeft, Save } from "lucide-react"

const CHANNEL_TYPES: ChannelType[] = ["sync", "async"]
const PROTOCOLS: ChannelProtocol[] = ["rest", "http", "kafka"]

function ChannelForm({ existing }: { existing?: Channel }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()

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
  const [error, setError] = useState<string | null>(null)

  const backTo = existing ? `/channels/${existing.channel_id}` : "/channels"

  const handleSubmit = () => {
    setError(null)

    if (!name.trim()) {
      setError("Name is required")
      return
    }

    const methodList = methods
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)

    const common = {
      name,
      description: description || undefined,
      methods: methodList.length > 0 ? methodList : undefined,
      route_pattern: routePattern || undefined,
      topic: topic || undefined,
      consumer_group: consumerGroup || undefined,
      workflow_id: workflowId || undefined,
      config,
      priority: Number(priority) || 0,
    }

    if (existing) {
      const req: UpdateChannelRequest = common
      updateChannel.mutate(
        { id: existing.channel_id, req },
        {
          onSuccess: () => navigate(`/channels/${existing.channel_id}`),
          onError: (e) => setError(e instanceof Error ? e.message : "Update failed"),
        }
      )
    } else {
      const req: CreateChannelRequest = { ...common, channel_type: channelType, protocol }
      createChannel.mutate(req, {
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
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="orders" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Type</label>
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
              <label className="mb-1 block text-sm font-medium">Protocol</label>
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
              <label className="mb-1 block text-sm font-medium">Methods</label>
              <Input value={methods} onChange={(e) => setMethods(e.target.value)} placeholder="GET, POST" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Route Pattern</label>
            <Input value={routePattern} onChange={(e) => setRoutePattern(e.target.value)} placeholder="/api/v1/orders" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Topic</label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Consumer Group</label>
              <Input value={consumerGroup} onChange={(e) => setConsumerGroup(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Linked Workflow ID</label>
            <Input value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
          </div>

          <ChannelConfigEditor value={config} onChange={setConfig} />

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
