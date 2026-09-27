import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Breadcrumbs, type Crumb } from "@/components/shared/breadcrumbs"
import { cn } from "@/lib/utils"

interface DetailHeaderProps {
  /** The trail; its innermost label also names the browser tab (via Breadcrumbs). */
  breadcrumbs: Crumb[]
  title: string
  /** Extra classes on the <h1> — e.g. `font-mono` for an id-shaped title. */
  titleClassName?: string
  /** Status / version chips rendered inline after the title. */
  badges?: ReactNode
  /** A secondary row under the title: tags, counts, a "runs on" line. */
  meta?: ReactNode
  /** Right-aligned actions: lifecycle controls, Edit, Map, links. */
  actions?: ReactNode
}

/**
 * The one header every detail page leads with: breadcrumb, then a title row with
 * its status chips and actions, at one tracking value and one rhythm.
 *
 * Replaces the hand-rolled `<h1 className="… text-2xl font-bold">` each detail
 * page carried. Those had drifted from the list pages: `PageHeader` and
 * `CardTitle` set `tracking-tight`, while a bare detail `<h1>` fell back to the
 * `-0.01em` global heading rule, so list and detail titles read at two
 * tightnesses. This lands them all on `tracking-tight`, and pins the
 * breadcrumb-to-title gap so it no longer inherits the page's 24px stack.
 */
export function DetailHeader({
  breadcrumbs,
  title,
  titleClassName,
  badges,
  meta,
  actions,
}: DetailHeaderProps) {
  return (
    <div className="space-y-3">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1
              className={cn(
                "min-w-0 break-words text-2xl font-bold tracking-tight",
                titleClassName
              )}
            >
              {title}
            </h1>
            {badges}
          </div>
          {meta && <div className="mt-2">{meta}</div>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}

/**
 * The loading state every detail page shows: breadcrumb ▸ title + chips ▸ body,
 * at the real proportions, so a load reads as the page arriving rather than the
 * two disconnected gray slabs each page used to render (and at widths that
 * disagreed page to page).
 */
export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-12 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
