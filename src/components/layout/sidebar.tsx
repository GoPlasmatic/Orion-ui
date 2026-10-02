import { NavLink } from "react-router"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { NAV_SECTIONS, type NavItem } from "@/lib/nav"
import { useNavCounts } from "@/hooks/use-attention"
import { useEngineStatus } from "@/hooks/use-engine"
import { usePlugins } from "@/hooks/use-plugins"
import { useModels } from "@/hooks/use-models"

/** How a count reads: what needs a hand is red, what is merely backed up is amber. */
const BADGE_TONE: Record<NonNullable<NavItem["badge"]>, string> = {
  alerts: "bg-destructive/15 text-destructive",
  dlq: "bg-destructive/15 text-destructive",
  breakers: "bg-warning/15 text-warning",
  schedules: "bg-warning/15 text-warning",
}

const BADGE_NAME: Record<NonNullable<NavItem["badge"]>, string> = {
  alerts: "open incidents",
  dlq: "exhausted entries",
  breakers: "open breakers",
  schedules: "pending occurrences",
}

/** A capability reads off as `false` (the 1.9 wire) or `"off"`; absent is unknown, not off. */
const isOff = (v: unknown) => v === false || v === "off"

/**
 * The nav items to leave out: Plugins and Models while their runtime is off
 * on this node *and* none exists. A runtime that is off with entities stored
 * keeps its item — those rows quarantine what names them, which is something
 * to go and look at. Plugins answer every route with 400 while off, which
 * reads as "none" here; models keep answering reads. Until both answers are
 * in, nothing is hidden, so the sidebar does not flicker an item away.
 */
function useHiddenNavItems(): Set<string> {
  const capabilities = useEngineStatus().data?.capabilities
  const pluginsOff = isOff(capabilities?.plugins)
  const modelsOff = isOff(capabilities?.models)
  const plugins = usePlugins({ limit: 1 }, pluginsOff)
  const models = useModels({ limit: 1 }, modelsOff)
  const hidden = new Set<string>()
  const none = (q: { data?: { data: unknown[] }; isError: boolean }) =>
    q.isError || (q.data != null && q.data.data.length === 0)
  if (pluginsOff && none(plugins)) hidden.add("plugins")
  if (modelsOff && none(models)) hidden.add("models")
  return hidden
}

/**
 * The navigation. Full width by default; a rail of icons when `collapsed`
 * (the toggle at its foot remembers per browser); and the same component
 * inside a drawer below `md`, where `onNavigate` closes the drawer.
 */
export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed?: boolean
  onToggleCollapsed?: () => void
  onNavigate?: () => void
}) {
  const counts = useNavCounts()
  const hidden = useHiddenNavItems()
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.capability || !hidden.has(item.capability)),
  }))

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-150",
        collapsed ? "w-14" : "w-60",
      )}
      data-collapsed={collapsed || undefined}
    >
      <NavLink
        to="/"
        onClick={onNavigate}
        title={collapsed ? "Orion — Operations" : undefined}
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border transition-colors outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 focus-visible:ring-inset",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <img src="/orion-logo.svg" alt="Orion" className="h-7 w-7" />
        {!collapsed && (
          <span className="font-display text-lg font-bold tracking-tight text-sidebar-foreground">
            Orion
          </span>
        )}
      </NavLink>
      <nav className="flex-1 space-y-3 overflow-y-auto p-2 md:p-3" aria-label="Main">
        {sections.map((section, i) => (
          <div key={section.label ?? i} className="space-y-1">
            {section.label &&
              (collapsed ? (
                <div className="mx-2 my-2 border-t border-sidebar-border" role="presentation" />
              ) : (
                <p
                  className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60"
                  title={section.hint}
                >
                  {section.label}
                </p>
              ))}
            {section.items.map((item) => {
              const count = item.badge ? counts[item.badge] : 0
              const shortcutHint = item.shortcut ? ` · press g then ${item.shortcut}` : ""
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={onNavigate}
                  title={collapsed || item.shortcut ? `${item.label}${shortcutHint}` : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      // The left rail is drawn with a ::before bar so the active
                      // item reads at a glance without shifting the label.
                      "relative flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors outline-none",
                      collapsed ? "justify-center px-0" : "px-3",
                      "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
                      "focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground before:opacity-100"
                        : "text-sidebar-foreground/80 before:opacity-0 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )
                  }
                >
                  <span className="relative">
                    <item.icon className="h-4 w-4 shrink-0" />
                    {collapsed && count > 0 && item.badge && (
                      <span
                        className={cn(
                          "absolute -right-2.5 -top-2 rounded-full px-1 text-[10px] font-semibold tabular-nums leading-4",
                          BADGE_TONE[item.badge]
                        )}
                        aria-label={`${count} ${BADGE_NAME[item.badge]}`}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </span>
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && count > 0 && item.badge && (
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded-full px-1.5 text-xs font-semibold tabular-nums",
                        BADGE_TONE[item.badge]
                      )}
                      aria-label={`${count} ${BADGE_NAME[item.badge]}`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            "flex h-11 shrink-0 items-center gap-3 border-t border-sidebar-border text-sm text-sidebar-foreground/70 transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 focus-visible:ring-inset",
            collapsed ? "justify-center" : "px-4",
          )}
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse to icons"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
    </aside>
  )
}
