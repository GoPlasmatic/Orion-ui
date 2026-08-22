import { useEffect, useState } from "react"
import { Outlet } from "react-router"
import { Sidebar } from "./sidebar"
import { Header } from "./header"
import { CommandPalette } from "@/components/shared/command-palette"

export function AppLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global ⌘K / Ctrl-K to open the command palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSearch={() => setPaletteOpen(true)} />
        {/* The width constraint lives on <main> itself, not on an inner wrapper:
            pages that fill the viewport (System Map's graph) size themselves with
            `h-full`, which only resolves against a parent with a definite height.
            `flex-1` gives <main> one; an auto-height wrapper would collapse them. */}
        <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
