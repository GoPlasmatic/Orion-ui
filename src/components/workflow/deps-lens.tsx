import { useMemo } from "react"
import { Link } from "react-router"
import { useQueries } from "@tanstack/react-query"
import { Network } from "lucide-react"
import type { Channel, Workflow } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { LensInsights } from "@/components/workflow/lens-insights"
import { Dash, LensTable, type LensColumn } from "@/components/workflow/lens-table"
import { OpChip } from "@/components/workflow/op-chip"
import { WorkflowDependencyMap, type MapCard, type MapResource } from "@/components/workflow/workflow-dependency-map"
import { useEntityIndex } from "@/hooks/use-entity-index"
import { useFunctionIndex } from "@/hooks/use-functions"
import { modelDependenciesQuery } from "@/hooks/use-models"
import { pluginDependenciesQuery } from "@/hooks/use-plugins"
import { useWorkflowDependencies } from "@/hooks/use-workflows"
import { entityRoute } from "@/lib/audit-routes"
import { RETRY_EFFECT_LABEL } from "@/lib/function-effects"
import { cronTransport } from "@/lib/cron"
import { formatMs } from "@/lib/traffic-encoding"
import { plural, shortDigest } from "@/lib/utils"
import {
  depsInsights,
  effectTone,
  formatOps,
  mergeServerResources,
  resourceColumns,
  resourceKey,
  taskRows,
  type CostView,
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

export function DepsLens({
  workflow,
  runsOn,
  sections,
  cost,
}: {
  workflow: Workflow
  runsOn: Channel[]
  sections: LensSection[]
  /** The measured cost, or null before the first run. */
  cost: CostView | null
}) {
  // The server's own walk: what the rows cannot see (unknown functions,
  // computed call targets) and the plugin digests this node resolves to.
  const { data: deps, error: depsError } = useWorkflowDependencies(workflow.workflow_id)
  const { index, graph, connectors } = useEntityIndex()
  const fnIndex = useFunctionIndex()
  const columns = useMemo(() => mergeServerResources(resourceColumns(sections), deps, fnIndex), [sections, deps, fnIndex])

  const named = (kind: "plugin" | "model") =>
    columns.filter((c) => c.ref.kind === kind && c.ref.name).map((c) => c.ref.name!)
  const pluginIds = named("plugin")
  const modelIds = named("model")

  // Who else each plugin and model serves — what an archive or a failed load reaches.
  const pluginDeps = useQueries({ queries: pluginIds.map((id) => ({ ...pluginDependenciesQuery(id), retry: false })) })
  const modelDeps = useQueries({ queries: modelIds.map((id) => ({ ...modelDependenciesQuery(id), retry: false })) })

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
  const connectorUsers = new Map(graph.connectors.map((c) => [c.name, c.users.length]))
  const registryLoaded = !!connectors

  const others = (users: string[] | undefined) => (users ? users.filter((w) => w !== workflow.workflow_id).length : null)
  const sharedLine = (n: number | null) =>
    n == null ? "" : n === 0 ? " · only this workflow" : ` · ${plural(n, "other workflow")}`

  const resourceCard = (c: ResourceColumn): MapResource => {
    const base = { key: c.key, opsLabel: formatOps(c.ops), tone: c.tone, weight: Math.max(1, c.steps.length) }
    const { kind, name } = c.ref
    if (!name) {
      return { ...base, title: `${kind} computed per message`, subtitle: "the target is an expression", state: "muted" }
    }
    if (kind === "connector") {
      const conn = index.connectorsByName.get(name)
      if (registryLoaded && !conn) return { ...base, title: name, subtitle: "not in the connector registry", state: "bad" }
      const users = connectorUsers.get(name) ?? 0
      return {
        ...base,
        title: name,
        subtitle: `${conn?.connector_type ?? "connector"}${users > 0 ? ` · shared by ${plural(users, "channel")}` : ""}`,
        href: entityRoute("connector", conn?.id) ?? undefined,
      }
    }
    if (kind === "plugin") {
      return {
        ...base,
        title: `${name}${c.ref.version != null ? ` v${c.ref.version}` : ""}`,
        subtitle: `plugin${sharedLine(others(pluginUsers.get(name)))}`,
        href: entityRoute("plugin", name) ?? undefined,
      }
    }
    if (kind === "model") {
      return {
        ...base,
        title: name,
        subtitle: `model${sharedLine(others(modelUsers.get(name)))}`,
        href: entityRoute("model", name) ?? undefined,
      }
    }
    const ch = index.channelsByName.get(name)
    if (registryLoaded && !ch) return { ...base, title: name, subtitle: "channel_call · not in the registry", state: "bad" }
    return { ...base, title: name, subtitle: "channel_call", href: entityRoute("channel", ch?.channel_id) ?? undefined }
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
          href: entityRoute("channel", c.channel_id) ?? undefined,
          state: c.status === "active" ? "default" : "muted",
        }))
      : [{ key: "none", title: "no channel", subtitle: "nothing reaches this workflow", state: "muted" }]

  const workflowCard: MapCard = {
    key: workflow.workflow_id,
    title: workflow.name,
    subtitle: shape,
    detail: cost ? `mean ${formatMs(cost.meanMs)} · ${plural(cost.runs, "run")}` : undefined,
  }

  const insights = depsInsights({
    sections,
    columns,
    workflowId: workflow.workflow_id,
    workflowName: workflow.name,
    pluginUsers,
    connectorUsers: registryLoaded ? connectorUsers : undefined,
    cost,
  })

  const tableColumns: LensColumn[] = [
    ...columns.map(
      (c): LensColumn => ({
        key: c.key,
        head: c.ref.name ?? `${c.ref.kind} (computed)`,
        headClassName: "font-mono text-xs",
        cell: (row) =>
          row.effect.resource && resourceKey(row.effect.resource) === c.key ? (
            <OpChip tone={effectTone(row.effect)} title={`On a retry: ${RETRY_EFFECT_LABEL[row.effect.retry]}`}>
              {row.effect.op}
            </OpChip>
          ) : null,
      }),
    ),
    {
      key: "writes",
      head: "Writes",
      cell: (row) =>
        row.writes.length ? <span className="font-mono text-xs text-muted-foreground">{row.writes.join(", ")}</span> : <Dash />,
    },
  ]

  const unresolved = deps?.unresolved_functions ?? []
  const mapLink = runsOn[0] ? `/system-map?select=${encodeURIComponent(runsOn[0].name)}` : "/system-map"
  const resources = columns.map(resourceCard)

  return (
    <div className="space-y-4">
      <WorkflowDependencyMap
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
            <p className="font-medium">{plural(unresolved.length, "function")} this node&apos;s registry does not know</p>
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

      <LensTable workflow={workflow} sections={sections} columns={tableColumns} caption="What each step touches" />

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
