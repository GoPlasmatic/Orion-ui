import { Blocks, Boxes, Plug, Unplug } from "lucide-react"
import type { HubKind } from "@/lib/dependency-graph"

/**
 * A hub's glyph — the sidebar's icon for its kind (`lib/nav.ts`), or a broken
 * plug for a connector the engine could not load.
 */
export function HubIcon({ kind, failed = false, className }: { kind: HubKind; failed?: boolean; className?: string }) {
  const Icon = failed ? Unplug : kind === "plugin" ? Blocks : kind === "model" ? Boxes : Plug
  return <Icon className={className} aria-hidden />
}
