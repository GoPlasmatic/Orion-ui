import { useHealth } from "@/hooks/use-health"
import { useTheme } from "@/lib/use-theme"
import { useDensity } from "@/lib/use-density"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Moon, Rows2, Rows3, Search, Sun } from "lucide-react"

export function Header({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { data: health } = useHealth()
  const { resolvedTheme, setTheme } = useTheme()
  const { compact, setCompact } = useDensity()

  const isHealthy = health?.status === "ok"

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card/80 px-4 backdrop-blur-md sm:px-6">
      <button
        onClick={onOpenSearch}
        className="inline-flex h-8 w-full max-w-72 items-center gap-2 rounded-md border border-input bg-background/60 px-3 text-sm text-muted-foreground shadow-xs transition-colors outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-md border bg-background/50 p-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCompact(!compact)}
            className="text-muted-foreground"
            aria-label={compact ? "Switch to comfortable density" : "Switch to compact density"}
            title={compact ? "Comfortable density" : "Compact density"}
          >
            {compact ? <Rows2 /> : <Rows3 />}
          </Button>
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

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            isHealthy
              ? "border-success/40 bg-success/10 text-success"
              : health
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted text-muted-foreground"
          )}
          title={isHealthy ? "Engine reachable" : health ? "Engine reporting unhealthy" : "Contacting engine"}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-current",
              !health && "animate-pulse"
            )}
          />
          <span className="hidden sm:inline">
            {isHealthy ? "Healthy" : health ? "Unhealthy" : "Checking…"}
          </span>
        </span>
      </div>
    </header>
  )
}
