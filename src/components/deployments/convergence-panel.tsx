import { useState } from "react"
import { useConvergence } from "@/hooks/use-deployments"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/shared/error-state"
import type { ConvergenceTarget } from "@/api/types"
import { cn } from "@/lib/utils"

const TARGETS: { value: ConvergenceTarget; label: string; hint: string }[] = [
  { value: "this-node", label: "This node", hint: "The node that answered" },
  { value: "observed", label: "Every node", hint: "Every node the cluster store has heard from" },
]

/**
 * Which nodes serve a revision. Polls every two seconds until it converges.
 * `observed` reads the cluster store's view of every node (orion-ext with
 * `[cluster]`); on a single node the two targets say the same thing.
 */
export function ConvergencePanel({ revision }: { revision: number }) {
  const [target, setTarget] = useState<ConvergenceTarget>("this-node")
  const { data, isLoading, error, refetch } = useConvergence(revision, target)

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label="Convergence target">
        {TARGETS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={target === t.value}
            title={t.hint}
            onClick={() => setTarget(t.value)}
            className={cn(
              "rounded px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              target === t.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : error || !data ? (
        <ErrorState title={`Could not read convergence on revision ${revision}`} error={error} onRetry={refetch} />
      ) : (
        <>
          <Callout variant={data.converged ? "success" : data.degraded_nodes.length > 0 ? "destructive" : "info"}>
            {data.converged
              ? `Converged: ${target === "this-node" ? "this node serves" : "every node observed serves"} revision ${data.target_revision}.`
              : data.degraded_nodes.length > 0
                ? `Not converged: ${data.degraded_nodes.length} node${data.degraded_nodes.length === 1 ? "" : "s"} cannot build revision ${data.target_revision} and keep serving the one before.`
                : `Converging on revision ${data.target_revision}…`}
          </Callout>
          <NodeList label="Serving it" nodes={data.converged_nodes} tone="ok" />
          <NodeList label="Still building" nodes={data.pending_nodes} tone="pending" />
          <NodeList label="Cannot build it" nodes={data.degraded_nodes} tone="bad" />
        </>
      )}
    </div>
  )
}

function NodeList({ label, nodes, tone }: { label: string; nodes: string[]; tone: "ok" | "pending" | "bad" }) {
  if (nodes.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {nodes.map((n) => (
          <Badge
            key={n}
            variant="outline"
            title={n}
            className={cn(
              "font-mono text-xs",
              tone === "ok" && "border-success/40 text-success",
              tone === "bad" && "border-destructive/40 text-destructive",
            )}
          >
            {n.slice(0, 8)}
          </Badge>
        ))}
      </div>
    </div>
  )
}
