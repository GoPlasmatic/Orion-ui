import { NavLink } from "react-router"
import { cn } from "@/lib/utils"
import {
  Gauge,
  Network,
  Radio,
  GitBranch,
  Plug,
  Activity,
  Inbox,
  Package,
  ZapOff,
  FileText,
  FunctionSquare,
  Terminal,
  Settings,
} from "lucide-react"

const navSections = [
  {
    items: [{ to: "/", icon: Gauge, label: "Operations" }],
  },
  {
    label: "System",
    items: [
      { to: "/system-map", icon: Network, label: "System Map" },
      { to: "/channels", icon: Radio, label: "Channels" },
      { to: "/workflows", icon: GitBranch, label: "Workflows" },
      { to: "/connectors", icon: Plug, label: "Connectors" },
      { to: "/functions", icon: FunctionSquare, label: "Functions" },
      { to: "/packages", icon: Package, label: "Packages" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { to: "/traces", icon: Activity, label: "Traces" },
      { to: "/trace-dlq", icon: Inbox, label: "Trace DLQ" },
      { to: "/circuit-breakers", icon: ZapOff, label: "Circuit Breakers" },
      { to: "/audit", icon: FileText, label: "Audit Log" },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/console", icon: Terminal, label: "Data Console" },
      { to: "/settings", icon: Settings, label: "Settings" },
    ],
  },
]

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <NavLink
        to="/"
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4 transition-colors outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 focus-visible:ring-inset"
      >
        <img
          src="/orion-logo.svg"
          alt="Orion"
          className="h-7 w-7"
        />
        <span className="font-display text-lg font-bold tracking-tight text-sidebar-foreground">
          Orion
        </span>
      </NavLink>
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {navSections.map((section, i) => (
          <div key={section.label ?? i} className="space-y-1">
            {section.label && (
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                {section.label}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    // The left rail is drawn with a ::before bar so the active
                    // item reads at a glance without shifting the label.
                    "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none",
                    "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
                    "focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground before:opacity-100"
                      : "text-sidebar-foreground/80 before:opacity-0 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
