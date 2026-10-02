import { useMemo } from "react"
import { Link } from "react-router"
import { useQueries } from "@tanstack/react-query"
import { Network } from "lucide-react"
import { pluginsApi } from "@/api/plugins"
import { modelsApi } from "@/api/models"
import type { Channel, Workflow, WorkflowDependencies } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DependencyMap, type MapCard, type MapResource } from "@/components/workflow/dependency-map"
import { LensInsights } from "@/components/workflow/lens-insights"
import { LensTable } from "@/components/workflow/lens-table"
import { useEntityIndex } from "@/hooks/use-entity-index"
import { useWorkflowCost } from "@/hooks/use-ops-metrics"
import { cronTransport } from "@/lib/cron"
import { shortDigest } from "@/lib/utils"
import {
  costView,
  depsInsights,
  dominantOp,
  formatMs,
  formatOps,
  mergeServerResources,
  resourceColumns,
  taskRows,
  type LensSection,
  type ResourceColumn,
} from "@/lib/workflow-lens"

/** How a channel is reached, in a line: `cron · <schedule> · async`, `POST /orders · sync`. */
function channelLine(c: Channel): string {
  const cron = cronTransport(c)
  if (cron) return `cron · ${cron.schedule} · ${c.channel_type}`
  if (c.protocol === "kafka") return `kafka · ${c.topic ?? "no topic"} · ${c.channel_type}`
  const methods = c.methods?.length ? c.methods.join(",") : "ANY"
  return `${methods} ${c.route_pattern ?? `/${c.name}`} · ${c.channel_type}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function DepsLens({
  workflow,
  runsOn,
  sections,
  deps,
  depsError,
}: {
  workflow: Workflow
  runsOn: Channel[]
  sections: LensSection[]
  deps: WorkflowDependencies | undefined
  depsError: unknown
}) {
  const { index, graph, connectors } = useEntityIndex()
  const cost = useWorkflowCost(workflow.workflow_id)
  const view = useMemo(() => (cost.runs > 0 ? costView(sections, cost) : null), [sections, cost])

  const columns = useMemo(() => mergeServerResources(resourceColumns(sections), deps), [sections, deps])
  const pluginIds = columns.filter((c) => c.ref.kind === "plugin").map((c) => c.ref.name)
  const modelIds = columns.filter((c) => c.ref.kind === "model" && !c.ref.dynamic).map((c) => c.ref.name)

  // Who else each plugin and model serves — what an archive or a failed load reaches.
  const pluginDeps = useQueries({
    queries: pluginIds.map((id) => ({
      queryKey: ["plugins", id, "dependencies"],
      queryFn: () => pluginsApi.dependencies(id),
      retry: false,
    })),
  })
  const modelDeps = useQueries({
    queries: modelIds.map((id) => ({
      queryKey: ["models", id, "dependencies"],
      queryFn: () => modelsApi.dependencies(id),
      retry: false,
    })),
  })

  const pluginUsers = new Map<string, string[]>()
  pluginIds.forEach((id, i) => {
    const d = pluginDeps[i]?.data
    if (d) pluginUsers.set(id, d.workflows)
  })
  const modelUsers = new Map<string, string[]>()
  modelIds.forEach((id, i) => {
    const d = modelDeps[i]?.data
    if (d) modelUsers.set(id, d.workflows.map((w) => w.workflow_id))
  })
  const pluginVersions = new Map((deps?.plugins ?? []).map((p) => [p.id, p.version]))
  const connectorUsers = new Map(graph.connectors.map((c) => [c.name, c.users.length]))
  const registryLoaded = !!connectors

  const others = (users: string[] | undefined) =>
    users ? users.filter((w) => w !== workflow.workflow_id).length : null
  const sharedLine = (n: number | null) =>
    n == null ? "" : n === 0 ? " · only this workflow" : ` · ${plural(n, "other workflow")}`

  const resourceCard = (c: ResourceColumn): MapResource => {
    const base = { key: c.key, opsLabel: formatOps(c.ops), op: dominantOp(c.ops), weight: Math.max(1, c.steps.length) }
    const { kind, name } = c.ref
    if (c.ref.dynamic) {
      return { ...base, title: `${kind} computed per message`, subtitle: "the target is an expression", tone: "muted" }
    }
    if (kind === "connector") {
      const conn = index.connectorsByName.get(name)
      if (registryLoaded && !conn) {
        return { ...base, title: name, subtitle: "not in the connector registry", tone: "bad" }
      }
      const users = connectorUsers.get(name) ?? 0
      return {
        ...base,
        title: name,
        subtitle: `${conn?.connector_type ?? "connector"}${users > 0 ? ` · shared by ${plural(users, "channel")}` : ""}`,
        href: conn ? `/connectors/${conn.id}` : undefined,
      }
    }
    if (kind === "plugin") {
      const v = pluginVersions.get(name)
      return {
        ...base,
        title: `${name}${v != null ? ` v${v}` : ""}`,
        subtitle: `plugin${sharedLine(others(pluginUsers.get(name)))}`,
        href: `/plugins/${encodeURIComponent(name)}`,
      }
    }
    if (kind === "model") {
      return {
        ...base,
        title: name,
        subtitle: `model${sharedLine(others(modelUsers.get(name)))}`,
        href: `/models/${encodeURIComponent(name)}`,
      }
    }
    const ch = index.channelsByName.get(name)
    if (registryLoaded && !ch) return { ...base, title: name, subtitle: "channel_call · not in the registry", tone: "bad" }
    return { ...base, title: name, subtitle: "channel_call", href: ch ? `/channels/${ch.channel_id}` : undefined }
  }

  const stepsIn = (phase: LensSection["phase"]) => taskRows(sections.filter((s) => s.phase === phase)).length
  const shape = workflow.loop
    ? `loop · setup ${stepsIn("setup")} · body ${stepsIn("body")} steps`
    : plural(taskRows(sections).length, "step")

  const channelCards: MapCard[] =
    runsOn.length > 0
      ? runsOn.map((c) => ({
          key: c.channel_id,
          title: c.name,
          subtitle: `${channelLine(c)}${c.status !== "active" ? ` · ${c.status}` : ""}`,
          href: `/channels/${c.channel_id}`,
          tone: c.status === "active" ? "default" : "muted",
        }))
      : [{ key: "none", title: "no channel", subtitle: "nothing reaches this workflow", tone: "muted" }]

  const workflowCard: MapCard = {
    key: workflow.workflow_id,
    title: workflow.name,
    subtitle: shape,
    detail: view ? `mean ${formatMs(view.meanMs)} · ${view.runs.toLocaleString("en")} runs` : undefined,
  }

  const insights = depsInsights({
    sections,
    columns,
    workflowId: workflow.workflow_id,
    workflowName: workflow.name,
    pluginUsers,
    pluginVersions,
    connectorUsers: registryLoaded ? connectorUsers : undefined,
    cost: view,
  })

  const unresolved = deps?.unresolved_functions ?? []
  const mapLink = runsOn[0] ? `/system-map?select=${encodeURIComponent(runsOn[0].name)}` : "/system-map"
  const resources = columns.map(resourceCard)

  return (
    <div className="space-y-4">
      <DependencyMap
        channels={channelCards}
        workflow={workflowCard}
        resources={resources}
        label={`${workflow.name} runs on ${runsOn.map((c) => c.name).join(", ") || "no channel"} and depends on ${
          resources.map((r) => `${r.title} (${r.opsLabel})`).join(", ") || "nothing outside the message"
        }`}
      />

      {deps?.has_dynamic_channel_calls && (
        <Callout variant="warning">
          <span>
            A <code className="font-mono">channel_call</code> computes its target at runtime — its{" "}
            <code className="font-mono">channel</code> is an expression rather than a name — so this workflow can reach
            channels the map does not show.
          </span>
        </Callout>
      )}
      {unresolved.length > 0 && (
        <Callout variant="destructive">
          <div>
            <p className="font-medium">
              {plural(unresolved.length, "function")} this node&apos;s registry does not know
            </p>
            <p className="mt-1 text-xs">
              {unresolved.map((fn) => (
                <code key={fn} className="mr-2 font-mono">
                  {fn}
                </code>
              ))}
              — a plugin archived since the workflow was written, or one this node could not load. Activation here
              would be refused, and a stored active version is quarantined.
            </p>
          </div>
        </Callout>
      )}
      {depsError != null && (
        <Callout variant="warning">
          The server&apos;s dependency walk could not be loaded, so this view is read from the steps alone
          {depsError instanceof Error ? `: ${depsError.message}` : "."}
        </Callout>
      )}

      <LensTable lens="deps" sections={sections} loop={workflow.loop} columns={columns} caption="What each step touches" />

      <LensInsights insights={insights} label="Dependency read-outs" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {deps ? `Resolved from version ${deps.version}'s steps by the server` : "Read from the steps"}
          {(deps?.plugins ?? []).map((p) => (
            <span key={p.id} title={p.digest}>
              {" "}
              · {p.id} {shortDigest(p.digest)}
            </span>
          ))}
        </span>
        <Button variant="outline" size="xs" asChild>
          <Link to={mapLink}>
            <Network /> Open in System Map
          </Link>
        </Button>
      </div>
    </div>
  )
}
