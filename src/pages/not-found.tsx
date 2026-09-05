import { Link, useLocation } from "react-router"
import { Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"

/**
 * The catch-all route. Without one an unknown URL rendered the shell around an
 * empty outlet — a blank page that looked like a loading failure.
 */
export function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <EmptyState
      icon={Compass}
      title="No page at this address"
      description={`Nothing is routed at ${pathname}. The link may come from an older version of the console, or the thing it pointed at was renamed.`}
      action={
        <>
          <Button variant="outline" asChild>
            <Link to="/channels">Channels</Link>
          </Button>
          <Button asChild>
            <Link to="/">Operations</Link>
          </Button>
        </>
      }
    />
  )
}
