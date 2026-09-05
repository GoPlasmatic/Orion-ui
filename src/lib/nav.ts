import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Blocks,
  CalendarClock,
  Cpu,
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
 * Grouped by the loop a person is in rather than by API resource: Build is
 * the developer's define → validate → test loop in the order the smoke flow
 * uses it; Observe is the operator's watch → drill → act loop; Govern is
 * change control and this instance.
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
}

export interface NavSection {
  label?: string
  /** One line on what the group is for, shown as the heading's tooltip. */
  hint?: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
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
    label: "Observe",
    hint: "The operator's loop: watch, drill, act",
    items: [
      { to: "/traces", label: "Traces", icon: Activity, keywords: "executions runs history", shortcut: "t" },
      {
        to: "/schedules",
        label: "Schedules",
        icon: CalendarClock,
        keywords: "cron occurrences scheduled jobs ledger",
        shortcut: "s",
        badge: "schedules",
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
    ],
  },
  {
    label: "Govern",
    hint: "Change control, and this instance",
    items: [
      { to: "/audit", label: "Audit Log", icon: FileText, keywords: "who changed what when", shortcut: "a" },
      {
        to: "/packages",
        label: "Packages",
        icon: Package,
        keywords: "promotion receipts release applied staged",
        shortcut: "k",
      },
      {
        to: "/engine",
        label: "Engine",
        icon: Cpu,
        keywords: "settings health reload backups api docs swagger openapi",
        shortcut: "e",
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
