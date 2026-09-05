import { Link } from "react-router"
import { useWorkflowDependencies } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/ui/callout"
import { Blocks, Plug, Radio } from "lucide-react"

/**
 * What this workflow's tasks reference, per the server.
 *
 * This is the authoritative answer: the server walks the stored tasks, so it
 * cannot drift from the client's list of connector-bearing function names the
 * way `lib/topology.ts` can. It also reports dynamic `channel_call` targets,
 * which static parsing cannot see at all.
 */
export function WorkflowDependencies({ workflowId }: { workflowId: string }) {
  const { data, isLoading, error } = useWorkflowDependencies(workflowId)
  // Resolve names to ids so the connector chips can link. A name with no match
  // is a real finding: activation refuses a workflow naming a missing connector.
  const { data: connectors } = useConnectors({ limit: 1000 })
  const idByName = new Map((connectors?.data ?? []).map((c) => [c.name, c.id]))

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (error) {
    return (
      <Callout variant="destructive">
        {error instanceof Error ? error.message : "Failed to load dependencies"}
      </Callout>
    )
  }
  if (!data) return null

  const plugins = data.plugins ?? []
  const unresolved = data.unresolved_functions ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Resolved from version {data.version}'s tasks by the server.
      </p>

      {data.has_dynamic_channel_calls && (
        <Callout variant="warning">
          <span>
            A <code className="font-mono">channel_call</code> computes its target at runtime — its{" "}
            <code className="font-mono">channel</code> is an expression rather than a name. The
            channels below are only the statically-resolvable ones; this workflow can reach others.
          </span>
        </Callout>
      )}

      {unresolved.length > 0 && (
        <Callout variant="destructive">
          <p className="font-medium">
            {unresolved.length} function{unresolved.length === 1 ? "" : "s"} this node's registry
            does not know
          </p>
          <p className="mt-1 text-xs">
            {unresolved.map((fn) => (
              <code key={fn} className="mr-2 font-mono">{fn}</code>
            ))}
            — a plugin archived since the workflow was written, or one this node could not load.
            Activation here would be refused, and a stored active version is quarantined.
          </p>
        </Callout>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plug className="h-4 w-4 text-muted-foreground" />
              Connectors ({data.connectors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.connectors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No connector-backed tasks.</p>
            ) : (
              <ul className="space-y-2">
                {data.connectors.map((dep, i) => {
                  const id = idByName.get(dep.connector)
                  return (
                    <li
                      key={`${dep.connector}-${dep.function}-${i}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      {id ? (
                        <Link to={`/connectors/${id}`} className="font-medium underline">
                          {dep.connector}
                        </Link>
                      ) : (
                        <span
                          className="font-medium text-destructive"
                          title="Not in the connector registry — activation will refuse this workflow"
                        >
                          {dep.connector}
                        </span>
                      )}
                      <Badge variant="outline" className="font-mono text-xs">
                        {dep.function}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Radio className="h-4 w-4 text-muted-foreground" />
              Channels ({data.channels.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No <code className="font-mono">channel_call</code> tasks.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.channels.map((name) => (
                  <li key={name} className="text-sm font-medium">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 1.6: which plugin version and digest each plugin function resolves
            to on this node — what a package records and a promotion target is
            checked for. Absent from an older server, hence the guard. */}
        {plugins.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Blocks className="h-4 w-4 text-muted-foreground" />
                Plugins ({plugins.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {plugins.map((dep) => (
                  <li key={dep.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link to={`/plugins/${encodeURIComponent(dep.id)}`} className="font-mono font-medium underline">
                      {dep.id}
                    </Link>
                    <Badge variant="outline" className="text-xs">v{dep.version}</Badge>
                    <span className="font-mono text-xs text-muted-foreground" title={dep.digest}>
                      {dep.digest.slice(0, 19)}…
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {dep.functions.map((fn) => (
                        <Badge key={fn} variant="outline" className="font-mono text-[11px]">
                          {fn}
                        </Badge>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
