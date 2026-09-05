import { useParams, Link, useNavigate } from "react-router"
import {
  useChannel,
  useChannelVersions,
  useChangeChannelStatus,
  useCreateChannelVersion,
  useDeleteChannel,
  useChannelStatusDryRun,
  useTriggerChannel,
} from "@/hooks/use-channels"
import { useCronOccurrences, useRetryOccurrence } from "@/hooks/use-cron"
import { OccurrencesTable } from "@/components/shared/occurrences-table"
import { cronTransport, MISFIRE_POLICIES } from "@/lib/cron"
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
import { ArrowLeft, AlertCircle, CalendarClock, Pencil, Play } from "lucide-react"

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: channel, isLoading, error } = useChannel(id ?? "")
  const statusDryRun = useChannelStatusDryRun()
  const { data: versions, isLoading: versionsLoading } = useChannelVersions(id ?? "")
  const changeStatus = useChangeChannelStatus()
  const createVersion = useCreateChannelVersion()
  const deleteChannel = useDeleteChannel()
  const trigger = useTriggerChannel()
  const retry = useRetryOccurrence()

  // A cron channel's recent occurrences. Keyed by the stable id, and only
  // fetched for a cron channel — the ledger has nothing to say about a route.
  const schedule = cronTransport(channel)
  const { data: occurrences, isLoading: occurrencesLoading } = useCronOccurrences(
    { channel_id: id ?? "", limit: 10 },
    { enabled: !!schedule, refetchInterval: 15_000 },
  )

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
          {schedule && channel.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={trigger.isPending}
              onClick={() => trigger.mutate(channel.channel_id)}
              title="Run now, through the same claim and singleton path a scheduled occurrence takes"
            >
              <Play className="h-3.5 w-3.5" />
              {trigger.isPending ? "Triggering..." : "Trigger now"}
            </Button>
          )}
          <LifecycleActions
            onPreflight={() =>
              statusDryRun.mutate({ id: channel.channel_id, req: { status: "active" } })
            }
            preflight={statusDryRun.data ?? null}
            preflightPending={statusDryRun.isPending}
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
          {schedule && <TabsTrigger value="occurrences">Occurrences</TabsTrigger>}
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
          {schedule && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Expression</dt>
                    <dd className="mt-0.5 font-mono text-xs">{schedule.schedule}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Time zone</dt>
                    <dd className="mt-0.5">{schedule.timezone ?? "UTC"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Misfire policy</dt>
                    <dd className="mt-0.5" title={MISFIRE_POLICIES.find((p) => p.value === (schedule.misfire_policy ?? "latest"))?.hint}>
                      {schedule.misfire_policy ?? "latest"}
                      {schedule.misfire_policy === "catch_up" && schedule.max_catch_up != null && (
                        <span className="text-muted-foreground"> · up to {schedule.max_catch_up}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Concurrency</dt>
                    <dd className="mt-0.5">
                      {schedule.concurrency?.policy ?? "allow"}
                      {schedule.concurrency?.policy === "forbid" && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {" "}· {schedule.concurrency.key ?? channel.channel_id}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
                {schedule.payload && Object.keys(schedule.payload).length > 0 && (
                  <div className="mt-4">
                    <JsonViewer data={schedule.payload} label="Payload" maxHeight="12rem" />
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Not reachable at <code className="font-mono">data/{channel.name}</code> or by{" "}
                  <code className="font-mono">channel_call</code>: the schedule — or Trigger now —
                  is the only thing that starts it, so every run is in the{" "}
                  <Link to={`/schedules?channel_id=${encodeURIComponent(channel.channel_id)}`} className="underline underline-offset-2">
                    occurrence ledger
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          )}
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
                {!schedule && (
                  <>
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
                  </>
                )}
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
          </div>
        </TabsContent>

        {schedule && (
          <TabsContent value="occurrences">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  The ten most recent occurrences. A retry is another attempt at the same one.
                </p>
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/schedules?channel_id=${encodeURIComponent(channel.channel_id)}`}>
                    Full ledger
                  </Link>
                </Button>
              </div>
              <OccurrencesTable
                rows={occurrences?.data ?? []}
                isLoading={occurrencesLoading}
                showChannel={false}
                onRetry={(occId) => retry.mutate(occId)}
                retryPending={retry.isPending}
                emptyDescription={
                  channel.status === "active"
                    ? "Nothing has been due yet. The first occurrence is materialised within a poll interval of the schedule's next instant."
                    : "Occurrences are materialised only while the channel is active."
                }
              />
            </div>
          </TabsContent>
        )}

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
                    <span className="text-muted-foreground">Max concurrent / node</span>
                    <span>{channel.config.backpressure.max_concurrent_per_node}</span>
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
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Key</span>
                      <span className="font-mono text-xs">
                        {channel.config.cache.key_logic !== undefined
                          ? "key_logic"
                          : channel.config.cache.cache_key_fields?.length
                            ? channel.config.cache.cache_key_fields.join(", ")
                            : "whole payload"}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.response && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Response</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Mode</span>
                      <span>{channel.config.response.mode ?? "envelope"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cookies</span>
                      <span>{channel.config.response.cookies ? "Workflow may set" : "Off"}</span>
                    </div>
                    {channel.config.response.allowed_headers && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Allowed headers</span>
                        <span className="text-right font-mono text-xs">
                          {channel.config.response.allowed_headers.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.oauth2_login && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">OAuth2 sign-in</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Authorize</span>
                      <span className="truncate font-mono text-xs">{channel.config.oauth2_login.authorize_url}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Callback</span>
                      <span className="font-mono text-xs">{channel.config.oauth2_login.callback_path}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Scopes</span>
                      <span className="font-mono text-xs">
                        {channel.config.oauth2_login.scopes?.join(" ") || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PKCE</span>
                      <span>{channel.config.oauth2_login.pkce === false ? "Off" : "S256"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">id_token</span>
                      <span>{channel.config.oauth2_login.id_token ? "Verified (OIDC)" : "Not verified"}</span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    The grant reaches the workflow at{" "}
                    <code className="font-mono">metadata.oauth</code>; the authorize leg is the route
                    pattern, the callback the path above.
                  </p>
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

            {channel.config.origin_allow_list && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Origin allow list</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {channel.config.origin_allow_list.length > 0 ? (
                      channel.config.origin_allow_list.map((origin) => (
                        <Badge key={origin} variant="outline" className="text-xs">{origin}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">None configured</span>
                    )}
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
