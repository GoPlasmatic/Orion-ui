import { useHealth } from "@/hooks/use-health"
import { useTheme } from "@/lib/use-theme"
import { useDensity } from "@/lib/use-density"
import { cn } from "@/lib/utils"
import { Activity, Moon, Rows2, Rows3, Search, Sun } from "lucide-react"

export function Header({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { data: health } = useHealth()
  const { resolvedTheme, setTheme } = useTheme()
  const { compact, setCompact } = useDensity()

  const isHealthy = health?.status === "ok"

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <button
        onClick={onOpenSearch}
        className="inline-flex h-8 w-64 items-center gap-2 rounded-md border border-input bg-background/50 px-3 text-sm text-muted-foreground transition-colors hover:border-chart-2/40 hover:text-foreground"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCompact(!compact)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={compact ? "Switch to comfortable density" : "Switch to compact density"}
          title={compact ? "Comfortable density" : "Compact density"}
        >
          {compact ? <Rows2 className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Toggle theme"
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
        <div className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
              isHealthy
                ? "bg-[rgba(76,189,151,0.12)] text-[#4CBD97]"
                : health
                  ? "bg-[rgba(239,71,111,0.12)] text-[#EF476F]"
                  : "bg-muted text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isHealthy
                  ? "bg-[#4CBD97]"
                  : health
                    ? "bg-[#EF476F]"
                    : "bg-muted-foreground"
              )}
            />
            {isHealthy ? "Healthy" : health ? "Unhealthy" : "Checking..."}
          </span>
        </div>
      </div>
    </header>
  )
}
