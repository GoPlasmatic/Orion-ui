import type { ReactNode } from "react"
import { Link } from "react-router"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { AuditLog, EngineStatus } from "@/api/types"
import { countLoadIssues, noLoadIssues } from "@/api/types"
import { auditResourceRoute } from "@/lib/audit-routes"
import { cn, formatDate, formatRelative, formatUptime } from "@/lib/utils"

/** An audit action as a past-tense verb: `status_active` reads "activated". */
const ACTION_VERB: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  status_active: "activated",
  status_archived: "archived",
  status_draft: "returned to draft",
  import: "imported",
  new_version: "new version",
  rollout: "rollout changed",
  trigger: "triggered",
  retry: "retried",
  admit: "re-admitted",
  reset: "reset",
  requeue: "requeued",
  purge: "purged",
  reload: "reloaded",
}

const verb = (action: string) => ACTION_VERB[action] ?? action.replace(/_/g, " ")

/**
 * Which node this is and what it is running, in one line: instance(s) from
 * `orion_build_info`, version and build, the generation, uptime, what the
 * generation refused, the three opt-in runtimes, and the newest audit row —
 * "what changed?" is the first question in an incident.
 */
export function InstanceStrip({
  engine,
  instances,
  gitHash,
  nodeId,
  lastChange,
  resourceName,
  now,
}: {
  engine: EngineStatus | undefined
  /** `instance` label values from the metrics scrape; empty without metrics. */
  instances: string[]
  gitHash: string | null
  /** The breaker map's instance id — the fallback node name without metrics. */
  nodeId: string | null
  lastChange: AuditLog | null | undefined
  /** A resource id to the name a person knows it by, when the registry has it. */
  resourceName: (type: string, id: string) => string
  now: number
}) {
  if (!engine) {
    return (
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
      </Card>
    )
  }

  const issues = engine.load_issues
  const issueCount = countLoadIssues(issues)
  // Absent is a pre-1.9 server that cannot say — not zero.
  const issuesKnown = issues != null
  const caps = engine.capabilities
  const node =
    instances.length > 1
      ? `cluster · ${instances.length} nodes`
      : (instances[0] ?? (nodeId ? nodeId.slice(0, 8) : null))
  const nodeTitle =
    instances.length > 1
      ? `${instances.join(", ")} — this page's figures are summed across them; breakers and plugin loads are per node`
      : nodeId
        ? `${instances[0] ?? nodeId} — breaker state and plugin loads are per replica`
        : undefined
  const changeTo = lastChange ? auditResourceRoute(lastChange.resource_type, lastChange.resource_id) : null

  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm" aria-label="This instance">
      <span className="flex min-w-0 items-center gap-2" title={nodeTitle}>
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            issuesKnown && issueCount > 0 ? "bg-warning" : "bg-success",
          )}
          aria-hidden="true"
        />
        {node && <span className="truncate font-medium">{node}</span>}
        <span className="text-muted-foreground">
          {node && "· "}
          <span className="font-mono text-foreground" title={gitHash ? `build ${gitHash}` : undefined}>
            {engine.version}
          </span>
          {engine.generation != null && engine.generation > 0 && <> · gen {engine.generation}</>}
          {" · "}up {formatUptime(engine.uptime_seconds)}
        </span>
      </span>

      <Fact label="load issues" to="/engine" title={issuesKnown ? undefined : "This server predates the report (1.9) and cannot say"}>
        <span className={cn(issuesKnown && issueCount > 0 && "text-warning")}>
          {issuesKnown ? (noLoadIssues(issues) ? "0" : issueCount.toLocaleString()) : "unknown"}
        </span>
      </Fact>

      {caps && (
        <>
          <Fact label="cron">{caps.cron ? "on" : "off"}</Fact>
          <Fact label="plugins">{caps.plugins ? "on" : "off"}</Fact>
          <Fact label="models">{caps.models ? "on" : "off"}</Fact>
        </>
      )}

      {lastChange && (
        <span className="min-w-0 truncate text-muted-foreground sm:ml-auto">
          last change:{" "}
          {changeTo ? (
            <Link to={changeTo} className="font-medium text-foreground hover:underline">
              {resourceName(lastChange.resource_type, lastChange.resource_id)}
            </Link>
          ) : (
            <span className="font-medium text-foreground">
              {resourceName(lastChange.resource_type, lastChange.resource_id)}
            </span>
          )}{" "}
          {verb(lastChange.action)} ·{" "}
          <Link
            to={`/audit?resource_type=${encodeURIComponent(lastChange.resource_type)}&resource_id=${encodeURIComponent(lastChange.resource_id)}`}
            className="hover:underline"
            title={`${formatDate(lastChange.created_at)} by ${lastChange.principal}`}
          >
            {formatRelative(lastChange.created_at, now) ?? formatDate(lastChange.created_at)}
          </Link>
        </span>
      )}
    </Card>
  )
}

function Fact({
  label,
  children,
  to,
  title,
}: {
  label: string
  children: ReactNode
  to?: string
  title?: string
}) {
  const body = (
    <>
      <span className="text-muted-foreground">{label}</span>{" "}
      <span className="font-medium tabular-nums">{children}</span>
    </>
  )
  return to ? (
    <Link to={to} className="whitespace-nowrap rounded hover:underline" title={title}>
      {body}
    </Link>
  ) : (
    <span className="whitespace-nowrap" title={title}>
      {body}
    </span>
  )
}
