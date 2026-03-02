import { useState } from "react"
import { useEngineStatus } from "@/hooks/use-engine"
import { useRules } from "@/hooks/use-rules"
import { RuleWorkflow } from "@/components/rules/rule-workflow"
import { RuleStatusBadge } from "@/components/rules/rule-status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { Radio } from "lucide-react"

export function ChannelsPage() {
  const { data: engine, isLoading: engineLoading } = useEngineStatus()
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)

  const channels = engine?.channels ?? []

  // Auto-select first channel when data loads
  const activeChannel = selectedChannel ?? channels[0] ?? null

  const { data: rulesData, isLoading: rulesLoading } = useRules(
    activeChannel ? { channel: activeChannel, limit: 100 } : {}
  )

  const rules = rulesData?.data ?? []

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-0">
      {/* Left panel — channel list */}
      <div className="w-60 shrink-0 border-r overflow-y-auto">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Channels
          </h2>
        </div>
        {engineLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No channels found</div>
        ) : (
          <nav className="p-2 space-y-1">
            {channels.map((ch) => (
              <button
                key={ch}
                onClick={() => setSelectedChannel(ch)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left",
                  activeChannel === ch
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Radio className="h-3.5 w-3.5 shrink-0" />
                {ch}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Right panel — rules workflows */}
      <div className="flex-1 overflow-y-auto p-6">
        {!activeChannel ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select a channel to view its rules
          </div>
        ) : rulesLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-[500px] w-full" />
          </div>
        ) : rules.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No rules in channel "{activeChannel}"
          </div>
        ) : (
          <div className="space-y-8">
            <h1 className="text-2xl font-bold">{activeChannel}</h1>
            {rules.map((rule, index) => (
              <div key={rule.rule_id}>
                {index > 0 && <div className="border-t my-6" />}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold">{rule.name}</h2>
                    <RuleStatusBadge status={rule.status} />
                  </div>
                  {rule.description && (
                    <p className="text-sm text-muted-foreground">{rule.description}</p>
                  )}
                  <RuleWorkflow rule={rule} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
