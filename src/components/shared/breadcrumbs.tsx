import { useEffect } from "react"
import { Link, useLocation } from "react-router"
import { ChevronRight } from "lucide-react"
import { setPageTitle } from "@/lib/page-title"
import { cn } from "@/lib/utils"

export interface Crumb {
  label: string
  to?: string
}

/**
 * Where a page sits: `Channels / orders`. Replaces the "← Back to Channels"
 * button every detail page hand-rolled, which always went to the list rather
 * than where the person came from — the browser's own back does that. Also
 * names the tab after the trail, innermost first.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const { pathname } = useLocation()
  const trail = items.map((i) => i.label).join(" / ")
  useEffect(() => {
    setPageTitle(pathname, [...items].reverse().map((i) => i.label))
    // `trail` stands in for `items`, which is a fresh array every render.
  }, [pathname, trail]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {item.to && !last ? (
                <Link
                  to={item.to}
                  className="rounded underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn("truncate", last && "font-medium text-foreground")}
                  aria-current={last ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
