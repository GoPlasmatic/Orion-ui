import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Blocks,
  Boxes,
  CalendarClock,
  Cpu,
  DatabaseZap,
  FileText,
  Gauge,
  GitBranch,
  Inbox,
  Network,
  Package,
  Plug,
  Radio,
  Terminal,
  ZapOff,
} from "lucide-react"

/**
 * The one list of pages. The sidebar, the command palette's "Go to" group,
 * the `g` + key shortcuts and the tab title all read it, so a page is
 * registered once rather than in three files that drift.
 *
 * Grouped by what an operator is doing rather than by API resource: Monitor
 * is watch and drill; Build is the developer's define → validate → test loop
 * in the order the smoke flow uses it; Control is acting on the running
 * instance (caches, the dead-letter queue, breakers, the engine); Govern is
 * change control.
 */
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Extra words the palette matches on. */
  keywords?: string
  /** The key after `g` that jumps here. */
  shortcut?: string
  /** Which live count the sidebar draws beside it. */
  badge?: "alerts" | "dlq" | "breakers" | "schedules"
  /**
   * A runtime that is off by default. The sidebar hides the item while
   * `engine/status.capabilities` says the runtime is off *and* nothing of the
   * kind exists; the route, the palette entry and the shortcut keep working.
   */
  capability?: "plugins" | "models"
}

export interface NavSection {
  label?: string
  /** One line on what the group is for, shown as the heading's tooltip. */
  hint?: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Monitor",
    hint: "Watch the system and drill into what it did",
    items: [
      {
        to: "/",
        label: "Operations",
        icon: Gauge,
        keywords: "dashboard home overview attention",
        shortcut: "o",
        badge: "alerts",
      },
      {
        to: "/system-map",
        label: "System Map",
        icon: Network,
        keywords: "topology graph traffic calls",
        shortcut: "m",
      },
      { to: "/traces", label: "Traces", icon: Activity, keywords: "executions runs history", shortcut: "t" },
      {
        to: "/schedules",
        label: "Schedules",
        icon: CalendarClock,
        keywords: "cron occurrences scheduled jobs ledger cancel",
        shortcut: "s",
        badge: "schedules",
      },
    ],
  },
  {
    label: "Build",
    hint: "The developer's loop: define, validate, test",
    items: [
      { to: "/channels", label: "Channels", icon: Radio, keywords: "endpoints routes", shortcut: "c" },
      { to: "/workflows", label: "Workflows", icon: GitBranch, keywords: "pipelines tasks", shortcut: "w" },
      {
        to: "/connectors",
        label: "Connectors",
        icon: Plug,
        keywords: "http kafka db cache storage smtp elasticsearch",
        shortcut: "n",
      },
      {
        to: "/plugins",
        label: "Plugins",
        icon: Blocks,
        keywords: "wasm webassembly custom functions",
        shortcut: "p",
        capability: "plugins",
      },
      {
        to: "/models",
        label: "Models",
        icon: Boxes,
        keywords: "onnx inference model_infer tensor graph admission",
        shortcut: "i",
        capability: "models",
      },
      {
        to: "/console",
        label: "Data Console",
        icon: Terminal,
        keywords: "send test request payload",
        shortcut: "d",
      },
    ],
  },
  {
    label: "Control",
    hint: "Act on the running instance",
    items: [
      {
        to: "/caches",
        label: "Caches",
        icon: DatabaseZap,
        keywords: "response cache namespaces invalidate purge hit ratio",
        shortcut: "h",
      },
      {
        to: "/trace-dlq",
        label: "Trace DLQ",
        icon: Inbox,
        keywords: "dead letter queue retry failed async requeue",
        shortcut: "q",
        badge: "dlq",
      },
      {
        to: "/circuit-breakers",
        label: "Circuit Breakers",
        icon: ZapOff,
        keywords: "connector breaker reset open",
        shortcut: "b",
        badge: "breakers",
      },
      {
        to: "/engine",
        label: "Engine",
        icon: Cpu,
        keywords: "settings health reload backups api docs swagger openapi cluster generation capabilities",
        shortcut: "e",
      },
    ],
  },
  {
    label: "Govern",
    hint: "Change control: who changed what, and what was promoted",
    items: [
      { to: "/audit", label: "Audit Log", icon: FileText, keywords: "who changed what when", shortcut: "a" },
      {
        to: "/packages",
        label: "Packages",
        icon: Package,
        keywords: "promotion receipts release applied staged",
        shortcut: "k",
      },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

/** The nav item a path belongs to: the longest matching prefix; "/" only exactly. */
export function navItemFor(pathname: string): NavItem | undefined {
  let best: NavItem | undefined
  for (const item of NAV_ITEMS) {
    if (item.to === "/") {
      if (pathname === "/") return item
      continue
    }
    if (pathname === item.to || pathname.startsWith(`${item.to}/`)) {
      if (!best || item.to.length > best.to.length) best = item
    }
  }
  return best
}

/** The `g` + key table, for the shortcut listener. */
export const NAV_SHORTCUTS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.filter((i) => i.shortcut).map((i) => [i.shortcut as string, i.to]),
)
