import { useEffect, type ReactNode } from "react"
import { useLocation } from "react-router"
import { setPageTitle } from "@/lib/page-title"

interface PageHeaderProps {
  title: string
  description?: string
  children?: ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  // The page's own name is the tab's name; the shell only fills in when a page
  // does not carry a header (see lib/page-title.ts).
  const { pathname } = useLocation()
  useEffect(() => {
    setPageTitle(pathname, [title])
  }, [pathname, title])

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  )
}
