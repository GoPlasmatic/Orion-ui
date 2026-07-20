import { NavLink } from "react-router"
import { cn } from "@/lib/utils"
import {
  Gauge,
  Network,
  Radio,
  GitBranch,
  Plug,
  Activity,
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
    ],
  },
  {
    label: "Monitoring",
    items: [
      { to: "/traces", icon: Activity, label: "Traces" },
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
    <aside className="flex h-full w-60 flex-col border-r border-sidebar-border bg-sidebar">
      <NavLink
        to="/"
        className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4 transition-colors hover:bg-sidebar-accent/50"
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
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
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
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
