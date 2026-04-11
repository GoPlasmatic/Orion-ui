import { useHealth } from "@/hooks/use-health"
import { useTheme } from "@/lib/use-theme"
import { cn } from "@/lib/utils"
import { Activity, Moon, Sun } from "lucide-react"

export function Header() {
  const { data: health } = useHealth()
  const { resolvedTheme, setTheme } = useTheme()

  const isHealthy = health?.status === "ok"

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div />
      <div className="flex items-center gap-3">
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
