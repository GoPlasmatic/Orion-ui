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
import { useHealth } from "@/hooks/use-health"
import { OccurrencesTable } from "@/components/shared/occurrences-table"
import { ErrorState } from "@/components/shared/error-state"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { ChannelRecentTraces, ChannelTrafficCard } from "@/components/shared/channel-traffic"
import { cronTransport, MISFIRE_POLICIES } from "@/lib/cron"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/ui/callout"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/shared/status-badge"
import { LifecycleActions } from "@/components/shared/lifecycle-actions"
import { VersionHistory } from "@/components/shared/version-history"
import { VersionCompare } from "@/components/shared/version-compare"
import { RetrySafetyWarning } from "@/components/shared/retry-safety-warning"
import { JsonViewer } from "@/components/shared/json-viewer"
import { NeighbourhoodMap } from "@/components/graph/neighbourhood-map"
import { formatDate } from "@/lib/utils"
import { CalendarClock, Network, Pencil, Play, Send } from "lucide-react"

/** One label / value line in a configuration card. */
function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "truncate text-right font-mono text-xs" : "text-right"}>{children}</span>
    </div>
  )
}

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: channel, isLoading, error, refetch } = useChannel(id ?? "")
  const { data: health } = useHealth()
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
      <ErrorState
        title="Failed to load channel"
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/channels", label: "Back to Channels" }}
      />
    )
  }

  const isPending = changeStatus.isPending || createVersion.isPending || deleteChannel.isPending
  // The engine refused this channel at load. Until now the only place that
  // said so was the dashboard; the channel's own page looked perfectly normal.
  const quarantine = health?.channels?.quarantined?.find((q) => q.channel === channel.name)

  const auth = channel.config.auth
  const request = channel.config.request
  const rateLimit = channel.config.rate_limit

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Channels", to: "/channels" }, { label: channel.name }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-2xl font-bold">{channel.name}</h1>
          <StatusBadge status={channel.status} />
          <Badge variant="outline">v{channel.version}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {channel.status === "draft" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/channels/${channel.channel_id}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link
              to={`/system-map?select=${encodeURIComponent(channel.name)}`}
              title="This channel on the System Map: its callers, callees and live traffic"
            >
              <Network className="h-3.5 w-3.5" />
              Map
            </Link>
          </Button>
          {!schedule && (
            <Button variant="outline" size="sm" asChild>
              <Link
                to={`/console?channel=${encodeURIComponent(channel.name)}`}
                title="Open the Data Console with this channel selected"
              >
                <Send className="h-3.5 w-3.5" />
                Send test request
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

      {quarantine && (
        <Callout variant="destructive">
          <p className="font-medium">
            Quarantined — the engine refused this channel at load, so its route is not being
            served.
          </p>
          <p className="mt-1 text-xs">
            {quarantine.reason || "No reason was reported."} Fix the definition, then Validate; the
            next reload clears the quarantine.
          </p>
        </Callout>
      )}

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
          {/* What it is doing right now, and its last few runs — the operator's
              first two questions, which used to live on other pages. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChannelTrafficCard channelName={channel.name} />
            <ChannelRecentTraces channelName={channel.name} />
          </div>
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
              {/* What a retry would run twice — the catalogue's retry_safety
                  over this channel's workflow, once for every Retry button below. */}
              <RetrySafetyWarning workflowId={channel.workflow_id} action="Retrying an occurrence" />
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
            {/* The security-relevant section came last — it fell through to the
                raw JSON. Secrets are masked by the server; counts are shown. */}
            {auth && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Authentication</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <Row label="Mode">
                      <Badge variant="outline" className="uppercase">{auth.mode ?? "—"}</Badge>
                    </Row>
                    {auth.mode === "api_key" && (
                      <>
                        <Row label="Header" mono>{auth.header ?? "Authorization"}</Row>
                        {auth.scheme && <Row label="Scheme" mono>{auth.scheme}</Row>}
                        <Row label="Keys">{auth.keys?.length ?? 0} configured · values masked</Row>
                      </>
                    )}
                    {auth.mode === "hmac" && (
                      <>
                        {auth.preset && <Row label="Preset">{auth.preset}</Row>}
                        <Row label="Signature header" mono>{auth.header ?? "—"}</Row>
                        <Row label="Algorithm">{auth.algorithm ?? "sha256"} · {auth.encoding ?? "hex"}</Row>
                        {auth.timestamp && (
                          <Row label="Timestamp">
                            {auth.timestamp}
                            {auth.tolerance_secs != null ? ` · ±${auth.tolerance_secs}s` : ""}
                          </Row>
                        )}
                        <Row label="Secrets">
                          {(auth.secrets?.length ?? 0) + (auth.secret ? 1 : 0)} configured · masked
                        </Row>
                      </>
                    )}
                    {auth.mode === "jwt" && (
                      <>
                        <Row label="Algorithms" mono>{auth.algorithms?.join(", ") ?? "—"}</Row>
                        {auth.issuer && <Row label="Issuer" mono>{[auth.issuer].flat().join(", ")}</Row>}
                        {auth.audience && <Row label="Audience" mono>{[auth.audience].flat().join(", ")}</Row>}
                        <Row label="Keys" mono>
                          {auth.jwks_url ? `JWKS ${auth.jwks_url}` : `${auth.jwt_keys?.length ?? 0} inline key(s) · masked`}
                        </Row>
                        <Row label="Token source" mono>
                          {auth.source?.cookie
                            ? `cookie ${auth.source.cookie}`
                            : `${auth.source?.header ?? "Authorization"} ${auth.source?.scheme ?? "Bearer"}`}
                        </Row>
                        <Row label="Required">{auth.required === false ? "No — anonymous requests pass" : "Yes"}</Row>
                        {auth.claims_to_metadata && (
                          <Row label="Claims to metadata" mono>{auth.claims_to_metadata.join(", ")}</Row>
                        )}
                      </>
                    )}
                  </div>
                  {auth.authorization_logic !== undefined && (
                    <div className="mt-3">
                      <JsonViewer data={auth.authorization_logic} label="Authorization logic" maxHeight="12rem" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {rateLimit && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Rate Limiting</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {rateLimit.requests_per_second !== undefined && (
                      <Row label="Requests/sec">{rateLimit.requests_per_second}</Row>
                    )}
                    {rateLimit.burst !== undefined && <Row label="Burst">{rateLimit.burst}</Row>}
                    <Row label="Bucket key">
                      {rateLimit.key_logic !== undefined ? "key logic" : "caller identity"}
                    </Row>
                    {rateLimit.key_headers && rateLimit.key_headers.length > 0 && (
                      <Row label="Key headers" mono>{rateLimit.key_headers.join(", ")}</Row>
                    )}
                    {rateLimit.on_backend_error && (
                      <Row label="On backend error">{rateLimit.on_backend_error}</Row>
                    )}
                  </div>
                  {rateLimit.key_logic !== undefined && (
                    <div className="mt-3">
                      <JsonViewer data={rateLimit.key_logic} label="Key logic" maxHeight="12rem" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {request && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Request</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <Row label="Body mode">{request.body_mode ?? "auto"}</Row>
                    {request.cookies_to_metadata && (
                      <Row label="Cookies to metadata" mono>{request.cookies_to_metadata.join(", ")}</Row>
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
                  <div className="text-sm">
                    <Row label="Max concurrent / node">{channel.config.backpressure.max_concurrent_per_node}</Row>
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
                    <Row label="Enabled">{channel.config.cache.enabled ? "Yes" : "No"}</Row>
                    {channel.config.cache.ttl_secs !== undefined && (
                      <Row label="TTL">{channel.config.cache.ttl_secs}s</Row>
                    )}
                    <Row label="Key" mono>
                      {channel.config.cache.key_logic !== undefined
                        ? "key_logic"
                        : channel.config.cache.cache_key_fields?.length
                          ? channel.config.cache.cache_key_fields.join(", ")
                          : "whole payload"}
                    </Row>
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
                    <Row label="Mode">{channel.config.response.mode ?? "envelope"}</Row>
                    <Row label="Cookies">{channel.config.response.cookies ? "Workflow may set" : "Off"}</Row>
                    {channel.config.response.allowed_headers && (
                      <Row label="Allowed headers" mono>
                        {channel.config.response.allowed_headers.join(", ")}
                      </Row>
                    )}
                    {channel.config.response.error_bodies && (
                      <Row label="Error bodies" mono>
                        {Object.keys(channel.config.response.error_bodies).join(", ")}
                      </Row>
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
                    <Row label="Authorize" mono>{channel.config.oauth2_login.authorize_url}</Row>
                    <Row label="Callback" mono>{channel.config.oauth2_login.callback_path}</Row>
                    <Row label="Scopes" mono>{channel.config.oauth2_login.scopes?.join(" ") || "—"}</Row>
                    <Row label="PKCE">{channel.config.oauth2_login.pkce === false ? "Off" : "S256"}</Row>
                    <Row label="id_token">
                      {channel.config.oauth2_login.id_token ? "Verified (OIDC)" : "Not verified"}
                    </Row>
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
                    <Row label="Header" mono>{channel.config.deduplication.header ?? "Idempotency-Key"}</Row>
                    {channel.config.deduplication.window_secs !== undefined && (
                      <Row label="Window">{channel.config.deduplication.window_secs}s</Row>
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
                      <Row label="Mode">
                        <Badge variant="outline" className="uppercase">{channel.config.tracing.mode}</Badge>
                      </Row>
                    )}
                    {channel.config.tracing.sample_rate !== undefined && (
                      <Row label="Sample Rate">{channel.config.tracing.sample_rate}</Row>
                    )}
                    {channel.config.tracing.errors_only !== undefined && (
                      <Row label="Errors Only">{channel.config.tracing.errors_only ? "Yes" : "No"}</Row>
                    )}
                    {channel.config.tracing.task_details !== undefined && (
                      <Row label="Per-Task Trace">{channel.config.tracing.task_details ? "Captured" : "Off"}</Row>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {channel.config.validation_logic !== undefined && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Validation logic</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Evaluated over {"{data, metadata}"} at the channel boundary; a falsy result
                    answers 400 before any workflow runs.
                  </p>
                  <JsonViewer data={channel.config.validation_logic} maxHeight="12rem" />
                </CardContent>
              </Card>
            )}

            {/* Raw JSON fallback */}
            <JsonViewer data={channel.config} label="Raw Configuration" />
          </div>
        </TabsContent>

        <TabsContent value="relationships">
          <NeighbourhoodMap kind="channel" id={channel.channel_id} />
        </TabsContent>

        <TabsContent value="versions">
          <div className="space-y-6">
            <VersionHistory versions={versions} isLoading={versionsLoading} />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Compare versions</h3>
              <VersionCompare versions={versions} isLoading={versionsLoading} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
