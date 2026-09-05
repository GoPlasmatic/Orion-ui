import { useEffect, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { Sidebar } from "./sidebar"
import { Header } from "./header"
import { CommandPalette } from "@/components/shared/command-palette"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { NAV_SHORTCUTS, navItemFor } from "@/lib/nav"
import { setFallbackTitle } from "@/lib/page-title"
import { readStorage, writeStorage } from "@/lib/storage"

/** A `g` followed by a key within this long jumps to the page the key names. */
const CHORD_MS = 1500
const SIDEBAR_KEY = "orion-sidebar"

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable)

export function AppLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  // The sidebar is a rail of icons when collapsed (remembered per browser),
  // and a drawer over the page below the `md` breakpoint.
  const [collapsed, setCollapsed] = useState(() => readStorage(SIDEBAR_KEY) === "collapsed")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const chordAt = useRef(0)

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    writeStorage(SIDEBAR_KEY, next ? "collapsed" : "expanded")
  }

  // Fallback tab title from the registry; a page that names itself wins.
  useEffect(() => {
    setFallbackTitle(location.pathname, navItemFor(location.pathname)?.label)
  }, [location.pathname])

  // Global ⌘K / Ctrl-K opens the palette; `?` too. `g` then a key jumps to a
  // page — the same table the sidebar tooltips and the palette show. Escape
  // closes the drawer.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (e.key === "Escape") {
        setDrawerOpen(false)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (e.key === "?") {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (e.key === "g") {
        chordAt.current = Date.now()
        return
      }
      if (chordAt.current && Date.now() - chordAt.current < CHORD_MS) {
        chordAt.current = 0
        const to = NAV_SHORTCUTS[e.key]
        if (to) {
          e.preventDefault()
          navigate(to)
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [navigate])

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:flex">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 flex shadow-lg animate-in slide-in-from-left duration-150"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSearch={() => setPaletteOpen(true)} onOpenMenu={() => setDrawerOpen(true)} />
        {/* The width constraint lives on <main> itself, not on an inner wrapper:
            pages that fill the viewport (System Map's graph) size themselves with
            `h-full`, which only resolves against a parent with a definite height.
            `flex-1` gives <main> one; an auto-height wrapper would collapse them. */}
        <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-8">
          {/* Keyed on the path so a page that threw does not stay broken once
              the user navigates somewhere else. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
