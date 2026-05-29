import { useParams, Link, useNavigate } from "react-router"
import { useChannel, useChannelVersions, useChangeChannelStatus, useCreateChannelVersion, useDeleteChannel } from "@/hooks/use-channels"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/shared/status-badge"
import { LifecycleActions } from "@/components/shared/lifecycle-actions"
import { VersionHistory } from "@/components/shared/version-history"
import { JsonViewer } from "@/components/shared/json-viewer"
import { RelationshipGraph } from "@/components/graph/relationship-graph"
import { formatDate } from "@/lib/utils"
import { ArrowLeft, AlertCircle, Pencil } from "lucide-react"

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: channel, isLoading, error } = useChannel(id ?? "")
  const { data: versions, isLoading: versionsLoading } = useChannelVersions(id ?? "")
  const changeStatus = useChangeChannelStatus()
  const createVersion = useCreateChannelVersion()
  const deleteChannel = useDeleteChannel()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !channel) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/channels"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Channels</Link>
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load channel.</p>
        </div>
      </div>
    )
  }

  const isPending = changeStatus.isPending || createVersion.isPending || deleteChannel.isPending

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/channels"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Channels</Link>
      </Button>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{channel.name}</h1>
          <StatusBadge status={channel.status} />
          <Badge variant="outline">v{channel.version}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {channel.status === "draft" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/channels/${channel.channel_id}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Link>
            </Button>
          )}
          <LifecycleActions
            status={channel.status}
            isPending={isPending}
            onActivate={() => changeStatus.mutate({ id: channel.channel_id, req: { status: "active" } })}
            onArchive={() => changeStatus.mutate({ id: channel.channel_id, req: { status: "archived" } })}
            onNewVersion={() => createVersion.mutate(channel.channel_id)}
            onDelete={() => deleteChannel.mutate(channel.channel_id, { onSuccess: () => navigate("/channels") })}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Channel Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">ID</dt>
                  <dd className="font-mono text-xs mt-0.5">{channel.channel_id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="mt-0.5"><Badge variant="outline">{channel.channel_type}</Badge></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Protocol</dt>
                  <dd className="mt-0.5"><Badge variant="outline" className="uppercase">{channel.protocol}</Badge></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Route Pattern</dt>
                  <dd className="font-mono text-xs mt-0.5">{channel.route_pattern ?? "--"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Methods</dt>
                  <dd className="mt-0.5 flex gap-1">
                    {channel.methods && channel.methods.length > 0
                      ? channel.methods.map((m) => (
                          <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                        ))
                      : "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Linked Workflow</dt>
                  <dd className="mt-0.5">
                    {channel.workflow_id ? (
                      <Link to={`/workflows/${channel.workflow_id}`} className="text-primary hover:underline font-mono text-xs">
                        {channel.workflow_id}
                      </Link>
                    ) : "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="mt-0.5">{formatDate(channel.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="mt-0.5">{formatDate(channel.updated_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <div className="space-y-4">
            {channel.config.rate_limit && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Rate Limiting</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {channel.config.rate_limit.requests_per_second !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Requests/sec</span>
                        <span>{channel.config.rate_limit.requests_per_second}</span>
                      </div>
                    )}
                    {channel.config.rate_limit.burst !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Burst</span>
                        <span>{channel.config.rate_limit.burst}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.backpressure && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Backpressure</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Max Concurrent</span>
                    <span>{channel.config.backpressure.max_concurrent}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.timeout_ms !== undefined && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Timeout</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Timeout</span>
                    <span>{channel.config.timeout_ms}ms</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.cache && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Cache</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Enabled</span>
                      <span>{channel.config.cache.enabled ? "Yes" : "No"}</span>
                    </div>
                    {channel.config.cache.ttl_secs !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">TTL</span>
                        <span>{channel.config.cache.ttl_secs}s</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.deduplication && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Deduplication</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Header</span>
                      <span className="font-mono text-xs">{channel.config.deduplication.header ?? "Idempotency-Key"}</span>
                    </div>
                    {channel.config.deduplication.window_secs !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Window</span>
                        <span>{channel.config.deduplication.window_secs}s</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.cors && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">CORS</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {channel.config.cors.allowed_origins?.map((origin) => (
                      <Badge key={origin} variant="outline" className="text-xs">{origin}</Badge>
                    )) ?? <span className="text-sm text-muted-foreground">None configured</span>}
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.tracing && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Trace Storage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {channel.config.tracing.mode !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mode</span>
                        <Badge variant="outline" className="uppercase">{channel.config.tracing.mode}</Badge>
                      </div>
                    )}
                    {channel.config.tracing.sample_rate !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sample Rate</span>
                        <span>{channel.config.tracing.sample_rate}</span>
                      </div>
                    )}
                    {channel.config.tracing.errors_only !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Errors Only</span>
                        <span>{channel.config.tracing.errors_only ? "Yes" : "No"}</span>
                      </div>
                    )}
                    {channel.config.tracing.task_details !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Per-Task Trace</span>
                        <span>{channel.config.tracing.task_details ? "Captured" : "Off"}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Raw JSON fallback */}
            <JsonViewer data={channel.config} label="Raw Configuration" />
          </div>
        </TabsContent>

        <TabsContent value="relationships">
          <RelationshipGraph kind="channel" id={channel.channel_id} />
        </TabsContent>

        <TabsContent value="versions">
          <VersionHistory versions={versions} isLoading={versionsLoading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
