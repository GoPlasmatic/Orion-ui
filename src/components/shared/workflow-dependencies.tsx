import { Link } from "react-router"
import { useWorkflowDependencies } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/ui/callout"
import { Plug, Radio } from "lucide-react"

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Resolved from version {data.version}'s tasks by the server.
      </p>

      {data.has_dynamic_channel_calls && (
        <Callout variant="warning">
          <span>
            A <code className="font-mono">channel_call</code> picks its target at runtime with{" "}
            <code className="font-mono">channel_logic</code>. The channels below are only the
            statically-resolvable ones — this workflow can reach others.
          </span>
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
      </div>
    </div>
  )
}
