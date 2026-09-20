import { useEffect, useMemo } from "react"
import { Link, useLocation } from "react-router"
import {
  bootPackageServing,
  loadedModelKey,
  type EngineLoadIssues,
  type HealthResponse,
} from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { LoadIssuesReport } from "@/components/shared/load-issues"
import { componentStateBadgeClass, isComponentFault } from "@/lib/status"
import { componentRoute } from "@/lib/health"
import { cn, formatBytes, formatDate, shortDigest } from "@/lib/utils"

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
    "Degraded when the last reload failed: this node serves the previous generation — correct, but no longer what the database says. Clears on the next successful reload.",
  plugins:
    "`disabled` is a state, not a fault (plugins.enabled = false). Degraded when an active plugin did not load here, which quarantines the workflows naming its functions.",
  models:
    "`disabled` is a state, not a fault (models.enabled = false). Degraded when an active model could not be carried here — which quarantines the workflows naming it — or when this node's admission worker is down, the state in which a new registration waits for its verdict forever.",
  kafka: "The consume loop. `error` means no message is being consumed while HTTP keeps serving.",
  cron: "The scheduler. Degraded when the reconciler has not completed a pass for long enough that occurrences are being missed, or when it is off while an active cron channel is stored.",
  config_propagation:
    "Cluster mode. Degraded when this node committed a change and failed to tell its peers; they are stale, this node is not.",
  cluster_redis: "The shared guard backend in cluster mode.",
  packages:
    "Present only when [packages] apply names artifacts (1.9). `applying` while this node applies its own packages at startup — /readyz answers 503 meanwhile — then `ok` for good, because readiness is a startup condition here. `failed` means one did not apply and the process is exiting.",
}

/**
 * The `/health` report, component by component, plus the admin-only detail
 * behind it — background tasks, plugin and model load failures, the model
 * cache, the scheduler's own health — where an operator can read what a
 * coarse `degraded` is about.
 *
 * `loadIssues` is the same four lists read from `GET admin/engine/status`
 * (1.9), and takes precedence when the caller has them: `/health`'s copy is
 * served only to a caller the server recognises as an admin, so on an instance
 * with `admin_auth` on and no key reaching `/health` the coarse components
 * arrive with no detail at all, while the admin plane answers in full. Passing
 * `null` or leaving it out falls back to whatever `/health` carried.
 */
export function HealthComponents({
  health,
  loadIssues: reported,
}: {
  health: HealthResponse | undefined
  loadIssues?: EngineLoadIssues | null
}) {
  // `/engine#component-<name>` is where the dashboard sends a degraded
  // component that has no page of its own. Client-side navigation does not
  // scroll to a hash by itself, and the rows only exist once health arrives.
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash || !health) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" })
  }, [hash, health])

  // The four lists `/health` serves an admin caller are exactly what
  // `GET admin/engine/status` carries as `load_issues` (1.9) — one collector
  // on the server — so they render through one component. Built here rather
  // than read off `/health` as a whole, because this body nests them under
  // four different keys for historical reasons.
  const loadIssues = useMemo(
    () =>
      reported ?? {
        channels: health?.channels?.quarantined ?? [],
        connectors: health?.connectors?.failed_to_load ?? [],
        plugins: health?.plugins?.failed_to_load ?? [],
        models: health?.models?.failed_to_load ?? [],
      },
    [health, reported]
  )

  if (!health) return <p className="text-sm text-muted-foreground">Loading…</p>

  const components = Object.entries(health.components ?? {})
  const tasks = health.background_tasks ?? []
  const restarted = tasks.filter((t) => t.restarts > 0 || t.state !== "running")
  const loadedPlugins = health.plugins?.loaded ?? []
  const models = health.models
  const loadedModels = models?.loaded ?? []
  const cron = health.cron
  const packages = health.packages ?? []

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {components.map(([name, state]) => (
          <li
            key={name}
            id={`component-${name}`}
            className={cn(
              "flex items-start justify-between gap-4 px-3 py-2",
              hash === `#component-${name}` && "bg-accent"
            )}
          >
            <div className="min-w-0">
              <p className="font-mono text-sm">{name}</p>
              {COMPONENT_HINTS[name] && (
                <p className="text-xs text-muted-foreground">{COMPONENT_HINTS[name]}</p>
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
        ))}
      </ul>

      <LoadIssuesReport issues={loadIssues} />

      {packages.length > 0 && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Packages applied at startup</p>
          <ul className="space-y-1 text-xs">
            {packages.map((pkg) => (
              <li key={pkg.file} className="flex flex-wrap items-center gap-2">
                <span className="font-mono" title={pkg.file}>
                  {pkg.name || pkg.file}
                  {pkg.version && ` ${pkg.version}`}
                </span>
                <Badge
                  variant="outline"
                  className={componentStateBadgeClass(
                    pkg.state === "failed" ? "error" : bootPackageServing(pkg.state) ? "ok" : "degraded"
                  )}
                >
                  {pkg.state}
                </Badge>
                {pkg.error && <span className="text-destructive">{pkg.error}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            This node applies these itself at startup, through its own admin routes, before{" "}
            <code className="font-mono">/readyz</code> reports it ready. A restart is a no-op; a
            failure exits the process. Their receipts are on the{" "}
            <Link to="/packages" className="underline underline-offset-2">
              Packages
            </Link>{" "}
            page.
          </p>
        </div>
      )}

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
                  {p.functions.length} function{p.functions.length === 1 ? "" : "s"}
                  {p.compile_ms != null && ` · compiled in ${p.compile_ms}ms`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {models && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Models on this node</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Resident</dt>
              <dd className="mt-0.5 tabular-nums">
                {loadedModels.length} · {formatBytes(models.loaded_bytes)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Artifact cache</dt>
              <dd className="mt-0.5 tabular-nums">{formatBytes(models.cache_bytes)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Admission queue</dt>
              <dd className="mt-0.5 tabular-nums">{models.admission_queue_capacity ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Node</dt>
              <dd className="mt-0.5 font-mono" title={models.node}>
                {models.node ? models.node.slice(0, 8) : "—"}
              </dd>
            </div>
          </dl>
          {loadedModels.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {loadedModels.map((m) => (
                <li key={loadedModelKey(m)} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono" title={m.digest}>
                    {shortDigest(m.digest)}
                  </span>
                  {m.binding && (
                    <span
                      className="font-mono text-muted-foreground"
                      title={`Binding ${m.binding} — the inputs' names, dtypes and shapes and the output names, in manifest order. Two manifests over one artifact that bind the graph differently are two sessions.`}
                    >
                      {m.binding.slice(0, 8)}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {m.runtime}/{m.device} · {formatBytes(m.resident_bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Residency is this node's alone — the admission verdict is shared across the cluster,
            the bytes are not. A row is a loaded <em>session</em>, keyed by digest, binding,
            runtime and device: two manifests over one artifact that declare their outputs in a
            different order are two plans over one graph, so one digest can appear twice.
          </p>
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
