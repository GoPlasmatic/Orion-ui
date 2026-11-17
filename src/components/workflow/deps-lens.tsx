import { useMemo } from "react"
import { Link } from "react-router"
import { Network } from "lucide-react"
import type { Channel, Workflow } from "@/api/types"
import { Button } from "@/components/ui/button"
import { LensInsights } from "@/components/workflow/lens-insights"
import { Dash, LensTable, type LensColumn } from "@/components/workflow/lens-table"
import { OpChip } from "@/components/workflow/op-chip"
import { WorkflowDependencyMap, type MapCard, type MapResource } from "@/components/workflow/workflow-dependency-map"
import { useRegistry } from "@/hooks/use-registry"
import { entityRoute } from "@/lib/audit-routes"
import { RETRY_EFFECT_LABEL } from "@/lib/function-effects"
import { cronTransport } from "@/lib/cron"
import { formatMs } from "@/lib/traffic-encoding"
import { plural } from "@/lib/utils"
import {
  depsInsights,
  effectTone,
  formatOps,
  mergeRequiredResources,
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
  if (c.protocol === "kafka") return `kafka · ${String(c.transport_config.topic ?? "no topic")} · ${c.channel_type}`
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
  // The member's `requires` is the compiler's walk: every connection and
  // plugin the workflow reaches, including what the rows cannot attribute to
  // a step. The registry says who else requires each.
  const registry = useRegistry()
  const columns = useMemo(
    () => mergeRequiredResources(resourceColumns(sections), workflow.member.requires),
    [sections, workflow.member.requires],
  )

  const usersOf = (kind: "plugin" | "connection") => {
    const out = new Map<string, string[]>()
    for (const w of registry.workflows) {
      for (const r of w.member.requires ?? []) {
        if (r.kind === kind) out.set(r.id, [...(out.get(r.id) ?? []), w.workflow_id])
      }
    }
    return out
  }
  const pluginUsers = usersOf("plugin")
  const connectionUsers = usersOf("connection")
  const connectorUsers = new Map([...connectionUsers].map(([id, users]) => [id, users.length]))
  const connectionsById = new Map(registry.connections.map((m) => [m.entity.id, m]))
  const registryLoaded = !!registry.revision

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
      const conn = connectionsById.get(name)
      if (registryLoaded && !conn) return { ...base, title: name, subtitle: "not a connection the head deploys", state: "bad" }
      const others = (connectionUsers.get(name) ?? []).filter((w) => w !== workflow.workflow_id).length
      return {
        ...base,
        title: name,
        subtitle: `connection${conn ? ` r${conn.entity.revision}` : ""}${sharedLine(others)}`,
        href: entityRoute("connection", name) ?? undefined,
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
        subtitle: "model",
        href: entityRoute("model", name) ?? undefined,
      }
    }
    const ch = registry.channels.find((x) => x.name === name)
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
          subtitle: channelLine(c),
          href: entityRoute("channel", c.channel_id) ?? undefined,
          state: "default",
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

      <LensTable workflow={workflow} sections={sections} columns={tableColumns} caption="What each step touches" />

      <LensInsights insights={insights} label="Dependency read-outs" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Read from revision {workflow.revision}&apos;s steps and what its member requires
          {(workflow.member.requires ?? [])
            .filter((r) => r.kind === "plugin")
            .map((r) => (
              <span key={r.id}>
                {" "}
                · {r.id} r{r.revision}
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
