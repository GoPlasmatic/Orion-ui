import type { KeyboardEvent } from "react"
import { tableFeatures } from "@tanstack/react-table"

/**
 * Feature set shared by every list table. It is empty because v9 always builds
 * the core row model, and this app sorts, filters and paginates server-side —
 * add a feature here only if a table starts doing that work in the browser.
 */
export const listTableFeatures = tableFeatures({})

/** Classes for a row that opens something: the pointer, and a focus ring inside the row. */
export const ROW_ACTIVATABLE =
  "cursor-pointer outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"

/**
 * Props that make a clickable row reachable from the keyboard: it takes focus
 * in the tab order and Enter or Space opens it. A `<tr onClick>` alone is
 * invisible to anyone not using a mouse. A link or button inside the row keeps
 * its own keys — the handler ignores events that did not start on the row.
 */
export function activatableRow(onActivate: () => void) {
  return {
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      onActivate()
    },
  }
}
