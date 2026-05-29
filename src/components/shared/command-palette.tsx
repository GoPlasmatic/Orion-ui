import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { useTheme } from "@/lib/use-theme"
import { Dialog } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  Search,
  Gauge,
  Network,
  Radio,
  GitBranch,
  Plug,
  Activity,
  ZapOff,
  FileText,
  Terminal,
  Settings,
  Plus,
  Upload,
  SunMoon,
  type LucideIcon,
} from "lucide-react"

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  keywords?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

/**
 * ⌘K command palette built on the accessible Dialog. Offers quick navigation,
 * common actions, and fuzzy-ish substring search across channels, workflows, and
 * connectors (fetched only while open).
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const { data: channels } = useChannels(open ? { limit: 200 } : {})
  const { data: workflows } = useWorkflows(open ? { limit: 200 } : {})
  const { data: connectors } = useConnectors(open ? { limit: 200 } : {})

  // Reset transient state whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("")
      setActive(0)
    }
  }, [open])

  const go = (to: string) => {
    navigate(to)
    onClose()
  }

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: "nav-ops", label: "Operations", group: "Go to", icon: Gauge, run: () => go("/") },
      { id: "nav-map", label: "System Map", group: "Go to", icon: Network, run: () => go("/system-map") },
      { id: "nav-channels", label: "Channels", group: "Go to", icon: Radio, run: () => go("/channels") },
      { id: "nav-workflows", label: "Workflows", group: "Go to", icon: GitBranch, run: () => go("/workflows") },
      { id: "nav-connectors", label: "Connectors", group: "Go to", icon: Plug, run: () => go("/connectors") },
      { id: "nav-traces", label: "Traces", group: "Go to", icon: Activity, run: () => go("/traces") },
      { id: "nav-breakers", label: "Circuit Breakers", group: "Go to", icon: ZapOff, run: () => go("/circuit-breakers") },
      { id: "nav-audit", label: "Audit Log", group: "Go to", icon: FileText, run: () => go("/audit") },
      { id: "nav-console", label: "Data Console", group: "Go to", icon: Terminal, run: () => go("/console") },
      { id: "nav-settings", label: "Settings", group: "Go to", icon: Settings, run: () => go("/settings") },
    ]

    const actions: Command[] = [
      { id: "act-new-channel", label: "Create channel", group: "Actions", icon: Plus, run: () => go("/channels/new") },
      { id: "act-new-connector", label: "Create connector", group: "Actions", icon: Plus, run: () => go("/connectors/new") },
      { id: "act-import-workflow", label: "Import workflow", group: "Actions", icon: Upload, run: () => go("/workflows") },
      {
        id: "act-theme",
        label: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`,
        group: "Actions",
        icon: SunMoon,
        keywords: "theme dark light mode",
        run: () => {
          setTheme(resolvedTheme === "dark" ? "light" : "dark")
          onClose()
        },
      },
    ]

    const entities: Command[] = [
      ...(channels?.data ?? []).map((c) => ({
        id: `ch-${c.channel_id}`,
        label: c.name,
        hint: "channel",
        group: "Channels",
        icon: Radio,
        keywords: c.route_pattern ?? "",
        run: () => go(`/channels/${c.channel_id}`),
      })),
      ...(workflows?.data ?? []).map((w) => ({
        id: `wf-${w.workflow_id}`,
        label: w.name,
        hint: "workflow",
        group: "Workflows",
        icon: GitBranch,
        keywords: (w.tags ?? []).join(" "),
        run: () => go(`/workflows/${w.workflow_id}`),
      })),
      ...(connectors?.data ?? []).map((c) => ({
        id: `co-${c.id}`,
        label: c.name,
        hint: c.connector_type,
        group: "Connectors",
        icon: Plug,
        run: () => go(`/connectors/${c.id}`),
      })),
    ]

    return [...nav, ...actions, ...entities]
  }, [channels, workflows, connectors, resolvedTheme]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q)
    )
  }, [commands, query])

  // Keep the active index in range as the filtered set shrinks.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      filtered[active]?.run()
    }
  }

  // Group consecutive results by their group label for section headers.
  const groups: { group: string; items: Command[] }[] = []
  filtered.forEach((c) => {
    const last = groups[groups.length - 1]
    if (last && last.group === c.group) last.items.push(c)
    else groups.push({ group: c.group, items: [c] })
  })

  let flatIndex = -1

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl" aria-label="Command palette">
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search or jump to…"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">No results</p>
        ) : (
          groups.map((g) => (
            <div key={g.group} className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {g.group}
              </p>
              {g.items.map((c) => {
                flatIndex++
                const idx = flatIndex
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => c.run()}
                    onMouseMove={() => setActive(idx)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                      idx === active ? "bg-accent text-accent-foreground" : "text-foreground"
                    )}
                  >
                    <c.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && (
                      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground/60">
                        {c.hint}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </Dialog>
  )
}
