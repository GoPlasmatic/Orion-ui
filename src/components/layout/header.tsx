import { useHealth } from "@/hooks/use-health"
import { cn } from "@/lib/utils"
import { Activity } from "lucide-react"

export function Header() {
  const { data: health } = useHealth()

  const isHealthy = health?.status === "ok"

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
              isHealthy
                ? "bg-emerald-50 text-emerald-700"
                : health
                  ? "bg-red-50 text-red-700"
                  : "bg-muted text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isHealthy
                  ? "bg-emerald-500"
                  : health
                    ? "bg-red-500"
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
