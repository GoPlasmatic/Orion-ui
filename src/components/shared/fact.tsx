import type { ReactNode } from "react"
import { Link } from "react-router"
import { cn } from "@/lib/utils"

/**
 * A label over a value, inside a `<dl>` — the detail-panel pair the trace
 * step panel, the occurrence page and the inspectors each drew their own way.
 * `mono` for ids, durations and paths; `wide` spans two grid columns.
 */
export function Fact({
  label,
  children,
  wide,
  mono = true,
  title,
}: {
  label: string
  children: ReactNode
  wide?: boolean
  mono?: boolean
  title?: string
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")} title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 break-words", mono ? "font-mono text-[13px]" : "text-sm")}>{children}</dd>
    </div>
  )
}

/** `label value` on one line, for a status strip; a link when `to` is given. */
export function InlineFact({
  label,
  children,
  to,
  title,
}: {
  label: string
  children: ReactNode
  to?: string
  title?: string
}) {
  const body = (
    <>
      <span className="text-muted-foreground">{label}</span>{" "}
      <span className="font-medium tabular-nums">{children}</span>
    </>
  )
  return to ? (
    <Link to={to} className="whitespace-nowrap rounded hover:underline" title={title}>
      {body}
    </Link>
  ) : (
    <span className="whitespace-nowrap" title={title}>
      {body}
    </span>
  )
}
