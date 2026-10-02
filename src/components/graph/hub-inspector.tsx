import { useState } from "react"
import { Link } from "react-router"
import { ArrowRight, BrainCircuit, ChevronDown, ChevronRight, Link2, Plug, Puzzle, Stethoscope, Unplug, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Separator } from "@/components/ui/separator"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { middleTruncate, shortName } from "@/lib/domains"
import { dependantsByDomain, edgeLoad, type DependencyGraph, type Hub } from "@/lib/dependency-graph"
import type { ConnectorTrafficWindow } from "@/hooks/use-ops-metrics"
import type { MetricsState } from "@/hooks/use-metrics"
import { compactNumber, errorLevel, formatMs, formatPct, healthText } from "@/lib/traffic-encoding"

const HUB_ICON = { connector: Plug, plugin: Puzzle, model: BrainCircuit } as const
const HUB_ROUTE = {
  connector: (id: string) => `/connectors/${id}`,
  plugin: (id: string) => `/plugins/${encodeURIComponent(id)}`,
  model: (id: string) => `/models/${encodeURIComponent(id)}`,
} as const

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm tabular-nums", className)}>{value}</p>
    </div>
  )
}

const STATE_COPY: Record<MetricsState, string> = {
  loading: "Loading metrics…",
  off: "Metrics are off on this server — dependants are from static references only.",
  error: "Metrics are unreachable right now.",
  warming: "Waiting for a second sample; figures below are since the server started.",
  live: "",
}

/**
 * The inspector for a hub: a connector, plugin or model and everything that
 * depends on it, grouped by domain — the outage blast radius as a list.
 */
export function HubInspector({
  hub,
  dg,
  connectorTraffic,
  spanLabel,
  failedToLoad,
  onSelectChannel,
  onClose,
}: {
  hub: Hub
  dg: DependencyGraph
  connectorTraffic: ConnectorTrafficWindow
  spanLabel: string
  failedToLoad: string | null
  onSelectChannel: (name: string) => void
  onClose: () => void
}) {
  const Icon = failedToLoad ? Unplug : HUB_ICON[hub.kind]
  const ct = hub.kind === "connector" ? connectorTraffic.byConnector.get(hub.name) : undefined
  const groups = dependantsByDomain(dg, hub)
  // Small groups start open; a domain of sixty is one click away.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(groups.filter((g) => g.channels.length <= 8).map((g) => g.domain)),
  )
  const calls = ct ? (ct.windowed ?? ct.total) : 0
  const level = errorLevel(calls > 0 ? ct?.errorPct : null)
  const stateCopy = hub.kind === "connector" ? STATE_COPY[connectorTraffic.state] : ""

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", failedToLoad ? "text-destructive" : "text-muted-foreground")} />
            <p className="break-all font-display text-sm font-semibold">{hub.name}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hub.type ?? "unknown"} · {hub.dependants.length} dependant{hub.dependants.length === 1 ? "" : "s"} in view
          </p>
        </div>
        <div className="-mr-1 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const url = `${window.location.origin}/system-map?select=${encodeURIComponent(hub.id)}`
              void copyText(url, "Link", url)
            }}
            aria-label="Copy a link to this on the map"
            title="Copy link to this view"
            className="text-muted-foreground"
          >
            <Link2 />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector" className="text-muted-foreground">
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {hub.kind}
          </Badge>
          {!hub.known && (
            <Badge variant="outline" className="border-dashed text-[10px]">
              not registered
            </Badge>
          )}
          {hub.known && !hub.enabled && (
            <Badge variant="outline" className="text-[10px] text-warning">
              disabled
            </Badge>
          )}
        </div>

        {failedToLoad && (
          <Callout variant="destructive" className="py-2 text-xs">
            Failed to load — every task using it is failing. {failedToLoad}
          </Callout>
        )}
        {!hub.known && (
          <Callout variant="warning" className="py-2 text-xs">
            A workflow names this {hub.kind}, but nothing by that name is registered.
          </Callout>
        )}

        {hub.kind === "connector" && (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Calls</p>
              <span className="text-[10px] text-muted-foreground">{spanLabel}</span>
            </div>
            {stateCopy && <p className="mb-2 text-xs text-muted-foreground">{stateCopy}</p>}
            {ct && calls > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                <Stat
                  label={ct.windowed != null ? "rate" : "calls"}
                  value={ct.windowed != null ? `${compactNumber(ct.ratePerMin)}/m` : compactNumber(ct.total)}
                />
                <Stat label="errors" value={formatPct(ct.errorPct)} className={healthText[level]} />
                <Stat label="p95" value={formatMs(ct.p95Ms)} />
              </div>
            ) : (
              connectorTraffic.state !== "loading" && (
                <p className="text-xs text-muted-foreground">
                  {hub.dependants.length === 0 ? "Nothing references it and nothing called it." : "No calls measured in the window."}
                </p>
              )
            )}
          </div>
        )}

        <Separator />

        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Blast radius · {hub.dependants.length} channel{hub.dependants.length === 1 ? "" : "s"}
          </p>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">No channel in view depends on it.</p>
          ) : (
            <div className="space-y-1">
              {groups.map((g) => {
                const isOpen = open.has(g.domain)
                return (
                  <div key={g.domain}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev)
                          if (next.has(g.domain)) next.delete(g.domain)
                          else next.add(g.domain)
                          return next
                        })
                      }
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span className="font-medium">{g.domain}</span>
                      <span className="ml-auto font-mono tabular-nums text-muted-foreground">{g.channels.length}</span>
                    </button>
                    {isOpen && (
                      <div className="ml-4 border-l pl-1">
                        {g.channels.map((name) => {
                          const l = edgeLoad([name], hub, connectorTraffic.byEdge)
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => onSelectChannel(name)}
                              title={name}
                              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                            >
                              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                                {middleTruncate(shortName(name, dg.domainIndex), 30)}
                              </span>
                              {l.measured && (
                                <span
                                  className={cn(
                                    "shrink-0 font-mono text-[10px] tabular-nums",
                                    l.errorPct ? healthText[errorLevel(l.errorPct)] : "text-muted-foreground",
                                  )}
                                >
                                  {compactNumber(l.calls)}
                                  {l.errorPct ? ` · ${formatPct(l.errorPct)}` : ""}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {hub.known && (
        <div className="flex flex-wrap gap-2 border-t p-3">
          <Button variant="outline" size="sm" asChild>
            <Link to={HUB_ROUTE[hub.kind](hub.refId)}>
              {hub.kind === "connector" ? "Connector" : hub.kind === "plugin" ? "Plugin" : "Model"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          {hub.kind === "connector" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/connectors/${hub.refId}?test=1`} title="Probe whether the backend is reachable">
                <Stethoscope className="h-3.5 w-3.5" /> Test
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
