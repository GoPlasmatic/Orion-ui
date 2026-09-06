import { Link } from "react-router"
import { useHealth } from "@/hooks/use-health"
import { useCircuitBreakers } from "@/hooks/use-connectors"
import { useTheme } from "@/lib/use-theme"
import { useTimeZone } from "@/lib/use-time-zone"
import { isComponentFault } from "@/lib/status"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Globe, Menu, Moon, Search, Sun } from "lucide-react"

type EngineState = "healthy" | "degraded" | "unreachable" | "checking"

const PILL: Record<EngineState, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "border-success/40 bg-success/10 text-success" },
  // `degraded` is the server's own word, and a degraded `engine_reload`,
  // `config_propagation` or `cron` still passes readiness — the node serves
  // every request correctly. It used to render as "Unhealthy" in red, which
  // is the wording for a node that is down.
  degraded: { label: "Degraded", className: "border-warning/40 bg-warning/10 text-warning" },
  unreachable: {
    label: "Unreachable",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  checking: { label: "Checking…", className: "border-border bg-muted text-muted-foreground" },
}

export function Header({
  onOpenSearch,
  onOpenMenu,
}: {
  onOpenSearch: () => void
  /** Opens the navigation drawer; rendered below the `md` breakpoint only. */
  onOpenMenu?: () => void
}) {
  const { data: health, isError } = useHealth()
  const { zone } = useTimeZone()
  // No interval: the instance id is fixed for the life of the process, and the
  // dashboard's own poll refreshes the shared key whenever it is open.
  const { data: breakers } = useCircuitBreakers()
  const { resolvedTheme, setTheme } = useTheme()

  const faults = Object.entries(health?.components ?? {})
    .filter(([, state]) => isComponentFault(state))
    .map(([name, state]) => `${name}: ${state}`)
  const state: EngineState = isError
    ? "unreachable"
    : !health
      ? "checking"
      : health.status === "ok"
        ? "healthy"
        : "degraded"
  const pill = PILL[state]
  const hint =
    state === "unreachable"
      ? "The engine did not answer /health"
      : state === "degraded"
        ? faults.length > 0
          ? `Degraded — ${faults.join(", ")}. Open Operations for what to do.`
          : "The engine reports degraded. Open Operations for what to do."
        : state === "healthy"
          ? "Every component reports ok"
          : "Contacting the engine"
  const nodeId = breakers?.instance_id

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card/80 px-3 backdrop-blur-md sm:gap-4 sm:px-6">
      {onOpenMenu && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenMenu}
          className="shrink-0 text-muted-foreground md:hidden"
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
      )}
      <button
        onClick={onOpenSearch}
        className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background/60 px-3 text-sm text-muted-foreground shadow-xs transition-colors outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:max-w-72"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {zone === "utc" && (
          <Link
            to="/engine"
            className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-foreground lg:inline-flex"
            title="Every timestamp is shown in UTC. Change it on the Engine page, under Display."
          >
            <Globe className="h-3.5 w-3.5" /> times in UTC
          </Link>
        )}
        <div className="flex items-center rounded-md border bg-background/50 p-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="text-muted-foreground"
            aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>

        {nodeId && (
          <span
            className="hidden font-mono text-xs text-muted-foreground md:inline"
            title={`Instance ${nodeId}. Circuit-breaker state and plugin load state are per replica, so they describe this node only.`}
          >
            node {nodeId.slice(0, 8)}
          </span>
        )}

        <Link
          to="/"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            pill.className
          )}
          title={hint}
          aria-label={`Engine ${pill.label.toLowerCase()}. ${hint}`}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-current",
              state === "checking" && "animate-pulse"
            )}
          />
          <span className="hidden sm:inline">{pill.label}</span>
          {state === "degraded" && faults.length > 0 && (
            <span className="hidden tabular-nums lg:inline">· {faults.length}</span>
          )}
        </Link>
      </div>
    </header>
  )
}
