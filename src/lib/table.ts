import { tableFeatures } from "@tanstack/react-table"

/**
 * Feature set shared by every list table. It is empty because v9 always builds
 * the core row model, and this app sorts, filters and paginates server-side —
 * add a feature here only if a table starts doing that work in the browser.
 */
export const listTableFeatures = tableFeatures({})
