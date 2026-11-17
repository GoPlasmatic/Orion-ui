import { useMemo, useState } from "react"
import { matchPath, useLocation, useNavigate } from "react-router"
import { useChannel, useChannels } from "@/hooks/use-channels"
import { useWorkflow, useWorkflows } from "@/hooks/use-workflows"
import { readStorageJson, writeStorageJson } from "@/lib/storage"
import { useConnections } from "@/hooks/use-connections"
import { usePlugins } from "@/hooks/use-plugins"
import { useTheme } from "@/lib/use-theme"
import { NAV_ITEMS } from "@/lib/nav"
import { Dialog } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  Search,
  Radio,
  GitBranch,
  Plug,
  Blocks,
  CalendarClock,
  Plus,
  Upload,
  SunMoon,
  Network,
  Send,
  Activity,
  Play,
  type LucideIcon,
  GitCommitVertical,
} from "lucide-react"

/** Rows per group with an empty query; the entity lists run to hundreds. */
const GROUP_CAP_IDLE = 6
/** Rows per group once something is typed. */
const GROUP_CAP_SEARCH = 12

/** The last few commands run, in this browser — the thing most likely to be wanted again. */
const RECENT_KEY = "orion-palette-recent"
const RECENT_MAX = 5

function loadRecent(): string[] {
  const parsed = readStorageJson<unknown>(RECENT_KEY, [])
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
}

function recordRecent(id: string) {
  writeStorageJson(RECENT_KEY, [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX))
}

/** The entity the page under the palette is about, by the router's own matching. */
function entityIdAt(pathname: string, pattern: string): string {
  const id = matchPath(pattern, pathname)?.params.id
  return id && id !== "new" ? decodeURIComponent(id) : ""
}

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
 * connections (fetched only while open).
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  // Mount only while open, so query/selection reset by remounting rather than by
  // an effect that syncs state on the `open` edge.
  if (!open) return null
  return <CommandPaletteBody onClose={onClose} />
}

function CommandPaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  // Read once per opening; the palette remounts each time it opens.
  const [recent] = useState(loadRecent)

  // The entity lists are fetched only while the palette is mounted, under the
  // same key every other registry read uses, so nothing is fetched twice.
  const { data: channels } = useChannels()
  const { data: workflows } = useWorkflows()
  const { data: connections } = useConnections()
  const { data: plugins } = usePlugins()
  // The page's own entity, from the cache the detail page already filled.
  const { data: channel } = useChannel(entityIdAt(pathname, "/channels/:id/*"))
  const { data: workflow } = useWorkflow(entityIdAt(pathname, "/workflows/:id/*"))

  const go = (to: string) => {
    navigate(to)
    onClose()
  }

  const commands = useMemo<Command[]>(() => {
    // One registry with the sidebar (lib/nav.ts): a page is added once.
    const nav: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav-${item.to}`,
      label: item.label,
      hint: item.shortcut ? `g ${item.shortcut}` : undefined,
      group: "Go to",
      icon: item.icon,
      keywords: item.keywords,
      run: () => go(item.to),
    }))

    const actions: Command[] = [
      { id: "act-head", label: "What is deployed now", group: "Actions", icon: GitCommitVertical, keywords: "head revision manifest", run: () => go("/deployments") },
      { id: "act-upload-package", label: "Upload provider package", group: "Actions", icon: Upload, keywords: "connector provider admit", run: () => go("/provider-packages?upload=1") },
      { id: "act-studio", label: "Package studio", group: "Actions", icon: Plus, keywords: "scaffold lint pack provider", run: () => go("/provider-packages?tab=studio") },
      { id: "act-schedules", label: "Trigger a schedule", group: "Actions", icon: CalendarClock, keywords: "cron run now", run: () => go("/schedules") },
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

    // What the page under the palette is about. On a channel: the map, a test
    // request, its traces, and its editor while it is a draft. On a workflow
    // draft: its editor. Nothing that mutates without the page's own pre-flight.
    const contextual: Command[] = []
    if (channel) {
      contextual.push({
        id: `ctx-map-${channel.channel_id}`,
        label: `Open ${channel.name} in the System Map`,
        group: "This page",
        icon: Network,
        keywords: "map topology callers",
        run: () => go(`/system-map?select=${encodeURIComponent(channel.name)}`),
      })
      if (channel.protocol !== "cron") {
        contextual.push({
          id: `ctx-test-${channel.channel_id}`,
          label: `Send a test request to ${channel.name}`,
          group: "This page",
          icon: Send,
          keywords: "console try",
          run: () => go(`/console?channel=${encodeURIComponent(channel.name)}`),
        })
      }
      contextual.push({
        id: `ctx-traces-${channel.channel_id}`,
        label: `Traces for ${channel.name}`,
        group: "This page",
        icon: Activity,
        keywords: "runs history failed",
        run: () => go(`/traces?channel=${encodeURIComponent(channel.name)}`),
      })
    }
    if (workflow) {
      contextual.push({
        id: `ctx-test-wf-${workflow.workflow_id}`,
        label: `Test ${workflow.name}`,
        group: "This page",
        icon: Play,
        keywords: "dry run test definition",
        run: () => go(`/workflows/${encodeURIComponent(workflow.workflow_id)}?tab=test`),
      })
    }

    const entities: Command[] = [
      ...channels.map((c) => ({
        id: `ch-${c.channel_id}`,
        label: c.name,
        hint: "channel",
        group: "Channels",
        icon: Radio,
        keywords: c.route_pattern ?? "",
        run: () => go(`/channels/${encodeURIComponent(c.channel_id)}`),
      })),
      ...workflows.map((w) => ({
        id: `wf-${w.workflow_id}`,
        label: w.name,
        hint: "workflow",
        group: "Workflows",
        icon: GitBranch,
        keywords: (w.tags ?? []).join(" "),
        run: () => go(`/workflows/${encodeURIComponent(w.workflow_id)}`),
      })),
      ...connections.map((c) => ({
        id: `co-${c.connection_id}`,
        label: c.connection_id,
        hint: c.deployed ? `connection r${c.deployed.revision}` : "connection",
        group: "Connections",
        icon: Plug,
        run: () => go(`/connections/${encodeURIComponent(c.connection_id)}`),
      })),
      ...plugins.map((p) => ({
        id: `pl-${p.plugin_id}`,
        label: p.plugin_id,
        hint: "plugin",
        group: "Plugins",
        icon: Blocks,
        keywords: p.functions.join(" "),
        run: () => go(`/plugins/${encodeURIComponent(p.plugin_id)}`),
      })),
    ]

    return [...contextual, ...nav, ...actions, ...entities]
  }, [channels, workflows, connections, plugins, resolvedTheme, channel, workflow]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Run a command and remember it. */
  const runCommand = (c: Command) => {
    recordRecent(c.id)
    c.run()
  }

  /**
   * Ranked, then capped per group. An exact name beats a prefix beats a
   * substring beats a keyword hit, so typing a channel's name lands on the
   * channel rather than on whichever page happens to mention it; and with
   * nothing typed the palette shows a few of each kind rather than every
   * entity it fetched.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const cap = q ? GROUP_CAP_SEARCH : GROUP_CAP_IDLE
    const rank = (c: Command): number => {
      if (!q) return 0
      const label = c.label.toLowerCase()
      if (label === q) return 0
      if (label.startsWith(q)) return 1
      if (label.includes(q)) return 2
      if (`${c.group} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q)) return 3
      return -1
    }
    const ranked = commands
      .map((c, index) => ({ c, index, r: rank(c) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.index - b.index)
    const perGroup = new Map<string, number>()
    const out: Command[] = []
    // With nothing typed, what was run last leads — as its own group, so the
    // same command can still appear under its kind below.
    if (!q) {
      for (const id of recent) {
        const found = commands.find((c) => c.id === id)
        if (found) out.push({ ...found, id: `recent-${found.id}`, group: "Recent" })
      }
    }
    for (const { c } of ranked) {
      const n = perGroup.get(c.group) ?? 0
      if (n >= cap) continue
      perGroup.set(c.group, n + 1)
      out.push(c)
    }
    return out
  }, [commands, query, recent])

  // Clamp during render rather than syncing in an effect: the filtered set shrinks
  // as the query narrows, which can leave the stored index past the last row.
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(Math.min(activeIndex + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const c = filtered[activeIndex]
      if (c) runCommand(c)
    }
  }

  // Results are ranked across groups, so group them by label rather than by
  // adjacency, keeping the order each group first appeared in.
  const groups = useMemo(() => {
    const acc: { group: string; items: Command[] }[] = []
    for (const c of filtered) {
      const existing = acc.find((g) => g.group === c.group)
      if (existing) existing.items.push(c)
      else acc.push({ group: c.group, items: [c] })
    }
    return acc
  }, [filtered])

  let flatIndex = -1

  return (
    <Dialog open onClose={onClose} className="max-w-xl" aria-label="Command palette">
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
      <div className="max-h-[60vh] overflow-y-auto p-2">
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
                    onClick={() => runCommand(c)}
                    onMouseMove={() => setActive(idx)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                      idx === activeIndex ? "bg-accent text-accent-foreground" : "text-foreground"
                    )}
                  >
                    <c.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground/60">
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          <kbd className="rounded border bg-muted px-1 font-mono">↑</kbd>{" "}
          <kbd className="rounded border bg-muted px-1 font-mono">↓</kbd> move
        </span>
        <span>
          <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> open
        </span>
        <span>
          <kbd className="rounded border bg-muted px-1 font-mono">esc</kbd> close
        </span>
        <span className="ml-auto">
          anywhere: <kbd className="rounded border bg-muted px-1 font-mono">g</kbd> then a key
          jumps to a page, <kbd className="rounded border bg-muted px-1 font-mono">?</kbd> opens
          this
        </span>
      </div>
    </Dialog>
  )
}
