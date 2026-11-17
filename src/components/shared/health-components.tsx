import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router"
import type { EngineLoadIssues, HealthResponse } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { LoadIssuesReport } from "@/components/shared/load-issues"
import { componentStateBadgeClass, isComponentFault } from "@/lib/status"
import { componentRoute } from "@/lib/health"
import { cn, formatDate, plural } from "@/lib/utils"
import { Info } from "lucide-react"

/** `cron.last_reconcile_at` is unix seconds, unlike every other admin-plane timestamp; tolerate an ISO string too. */
function formatCronInstant(value: number | string | null | undefined): string {
  if (value == null) return "never"
  return formatDate(typeof value === "number" ? value * 1000 : value)
}

/**
 * What each `/health` component means, so a `degraded` reads as a sentence
 * rather than a key. Most of these are silent failures by nature — a node that
 * reports them is alive, restarts nothing, and simply stops doing the thing.
 */
const COMPONENT_HINTS: Record<string, string> = {
  database: "The state database answers. `error` fails /readyz.",
  engine: "Constant ok — the engine snapshot cannot be unavailable once the process serves.",
  connectors: "Degraded when an enabled connector failed to load: every task using it is failing.",
  channels: "Degraded when a channel is quarantined — refused at load, its route not served.",
  background_tasks:
    "The supervised long-lived tasks. `degraded` is a restart in progress; `error` is a required task stopped for good, which fails /readyz.",
  engine_reload:
    "Degraded when the last build of the desired revision failed: this node serves the previous generation — correct, but no longer the deployment head. Clears on the next successful build.",
  plugins:
    "`disabled` is a state, not a fault (plugins.enabled = false). Degraded when a deployed plugin did not load here, which quarantines the workflows naming its functions.",
  cron: "The scheduler. Degraded when the reconciler has not completed a pass for long enough that occurrences are being missed, or when it is off while a deployed cron channel needs it.",
}

/**
 * The `/health` report, component by component, plus the admin-only detail
 * behind it — background tasks, plugin load failures and the scheduler's own
 * health — where an operator can read what a coarse `degraded` is about.
 *
 * `loadIssues` is the same three lists read from `GET admin/engine/status`,
 * and takes precedence when the caller has them: `/health`'s copy is served
 * only to a caller the server recognises as an admin, so on an instance with
 * `admin_auth` on and no key reaching `/health` the coarse components arrive
 * with no detail at all, while the admin plane answers in full. Passing `null`
 * or leaving it out falls back to whatever `/health` carried.
 */
export function HealthComponents({
  health,
  loadIssues: reported,
  showLoadIssues = true,
}: {
  health: HealthResponse | undefined
  loadIssues?: EngineLoadIssues | null
  /** Off where the page renders the generation's load issues elsewhere (the Engine page's Cluster tab). */
  showLoadIssues?: boolean
}) {
  // `/engine#component-<name>` is where the dashboard sends a degraded
  // component that has no page of its own. Client-side navigation does not
  // scroll to a hash by itself, and the rows only exist once health arrives.
  const { hash } = useLocation()
  // Rows whose explanation is toggled away from its default (open for a
  // fault, closed otherwise). Each row used to carry a paragraph of docs,
  // which buried the states under prose; now a healthy row is a name and a
  // state, and "what this means" is one click (or the tooltip) away.
  const [explained, setExplained] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExplained = (name: string) =>
    setExplained((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  useEffect(() => {
    if (!hash || !health) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" })
  }, [hash, health])

  // The three lists `/health` serves an admin caller are exactly what
  // `GET admin/engine/status` carries as `load_issues` — one collector on the
  // server — so they render through one component. Built here rather than read
  // off `/health` as a whole, because this body nests them under three
  // different keys for historical reasons.
  const loadIssues = useMemo(
    () =>
      reported ?? {
        channels: health?.channels?.quarantined ?? [],
        connectors: health?.connectors?.failed_to_load ?? [],
        plugins: health?.plugins?.failed_to_load ?? [],
      },
    [health, reported]
  )

  if (!health) return <p className="text-sm text-muted-foreground">Loading…</p>

  const components = Object.entries(health.components ?? {})
  const tasks = health.background_tasks ?? []
  const restarted = tasks.filter((t) => t.restarts > 0 || t.state !== "running")
  const loadedPlugins = health.plugins?.loaded ?? []
  const cron = health.cron

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {components.map(([name, state]) => {
          // A faulted row opens with its explanation; a toggle flips the default.
          const showHint = explained.has(name) !== isComponentFault(state)
          return (
            <li
              key={name}
              id={`component-${name}`}
              className={cn(
                "flex items-center justify-between gap-4 px-3 py-2",
                hash === `#component-${name}` && "bg-accent"
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-mono text-sm">{name}</p>
                  {COMPONENT_HINTS[name] && (
                    <button
                      type="button"
                      onClick={() => toggleExplained(name)}
                      aria-expanded={showHint}
                      aria-label={`What ${name} means`}
                      title={COMPONENT_HINTS[name]}
                      className="rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {COMPONENT_HINTS[name] && showHint && (
                  <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{COMPONENT_HINTS[name]}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isComponentFault(state) && componentRoute(name) && (
                  <Link to={componentRoute(name) as string} className="text-xs underline underline-offset-2">
                    Inspect
                  </Link>
                )}
                <Badge variant="outline" className={componentStateBadgeClass(state)}>
                  {state}
                </Badge>
              </div>
            </li>
          )
        })}
      </ul>

      {showLoadIssues && <LoadIssuesReport issues={loadIssues} />}

      {cron && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Scheduler</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Scheduled channels</dt>
              <dd className="mt-0.5 tabular-nums">{cron.scheduled_channels ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last reconcile</dt>
              <dd className="mt-0.5">
                {formatCronInstant(cron.last_reconcile_at)}
                {cron.reconcile_age_secs != null && (
                  <span className="text-muted-foreground"> · {Math.round(cron.reconcile_age_secs)}s ago</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Oldest pending</dt>
              <dd className="mt-0.5 tabular-nums">
                {cron.oldest_pending_age_secs == null ? "—" : `${Math.round(cron.oldest_pending_age_secs)}s`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lease renewal failures</dt>
              <dd className="mt-0.5 tabular-nums">{cron.lease_renewal_failures ?? 0}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            A lease renewal failure is work stopped in flight — always worth a look.{" "}
            <Link to="/schedules" className="underline underline-offset-2">
              Occurrence ledger
            </Link>
          </p>
        </div>
      )}

      {loadedPlugins.length > 0 && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Plugins loaded on this node</p>
          <ul className="space-y-1 text-xs">
            {loadedPlugins.map((p) => (
              <li key={`${p.plugin}-${p.version}`} className="flex flex-wrap items-center gap-2">
                <Link to={`/plugins/${encodeURIComponent(p.plugin)}`} className="font-mono">
                  {p.plugin} v{p.version}
                </Link>
                <span className="text-muted-foreground">
                  {plural(p.functions.length, "function")}
                  {p.compile_ms != null && ` · compiled in ${p.compile_ms}ms`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Background tasks</p>
          <ul className="space-y-1 text-xs">
            {tasks.map((t) => (
              <li key={t.name} className="flex items-center gap-2">
                <span className="font-mono">{t.name}</span>
                <Badge
                  variant="outline"
                  className={componentStateBadgeClass(
                    t.state === "running" ? "ok" : t.required ? "error" : "degraded"
                  )}
                >
                  {t.state}
                </Badge>
                {t.restarts > 0 && (
                  <span className="text-warning">
                    restarted {t.restarts}×
                  </span>
                )}
                {t.required && <span className="text-muted-foreground">required</span>}
              </li>
            ))}
          </ul>
          {restarted.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              A running task with a non-zero restart count is up now and has been failing.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
