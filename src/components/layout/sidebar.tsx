import { NavLink } from "react-router"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  History,
  Radio,
  Plug,
  Send,
} from "lucide-react"

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/invocations", icon: History, label: "Invocations" },
  { to: "/channels", icon: Radio, label: "Channels" },
  { to: "/connectors", icon: Plug, label: "Connectors" },
  { to: "/data", icon: Send, label: "Data Test" },
]

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
          O
        </div>
        <span className="text-lg font-semibold tracking-tight">Orion</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
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
      </nav>
    </aside>
  )
}
