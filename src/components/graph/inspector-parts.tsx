import type { ReactNode } from "react"
import { Link2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

/** One labelled figure in a map inspector. */
export function InspectorStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm tabular-nums", className)}>{value}</p>
    </div>
  )
}

/**
 * A map inspector's header: an icon, the name wrapped rather than cut (a name
 * cut from the right loses what tells it from its siblings), a subtitle, and
 * the copy-link and close buttons. `select` is the `?select=` value the
 * copied link lands on.
 */
export function InspectorHeader({
  icon,
  name,
  subtitle,
  select,
  lens,
  onClose,
}: {
  icon: ReactNode
  name: string
  subtitle: ReactNode
  select: string
  /** The lens the copied link opens, when the selection only exists on one. */
  lens?: string
  onClose: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-2 p-4 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {icon}
          <p className="break-all font-display text-sm font-semibold">{name}</p>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="-mr-1 flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            const url = `${window.location.origin}/system-map?${lens ? `lens=${lens}&` : ""}select=${encodeURIComponent(select)}`
            void copyText(url, "Link", url)
          }}
          aria-label={`Copy a link to ${name} on the map`}
          title="Copy link to this view"
          className="text-muted-foreground"
        >
          <Link2 />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector" className="text-muted-foreground">
          <X />
        </Button>
      </div>
    </div>
  )
}
