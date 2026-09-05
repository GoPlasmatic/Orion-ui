import { Link, useNavigate } from "react-router"
import type { CronOccurrenceSummary } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/shared/empty-state"
import { occurrenceStatusBadgeClass } from "@/lib/status"
import { isRetryable, occurrenceStatusLabel } from "@/lib/cron"
import { formatDate, formatDuration, serverSpan } from "@/lib/utils"
import { CalendarClock, RotateCcw } from "lucide-react"

/**
 * The occurrence ledger as a table, shared by the Schedules page (every
 * channel) and a cron channel's detail page (one channel, `showChannel` off).
 * Rows link to the occurrence, which is where the trace id, the executing
 * version and the lease detail live.
 */
export function OccurrencesTable({
  rows,
  isLoading,
  showChannel = true,
  onRetry,
  retryPending,
  emptyDescription,
}: {
  rows: CronOccurrenceSummary[]
  isLoading: boolean
  showChannel?: boolean
  onRetry?: (id: string) => void
  retryPending?: boolean
  emptyDescription?: string
}) {
  const navigate = useNavigate()
  const columns = 6 + (showChannel ? 1 : 0) + (onRetry ? 1 : 0)

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            {showChannel && <TableHead>Channel</TableHead>}
            <TableHead>Trigger</TableHead>
            <TableHead>Scheduled for</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Attempt</TableHead>
            {onRetry && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: columns }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns} className="p-0">
                <EmptyState
                  icon={CalendarClock}
                  title="No occurrences"
                  description={
                    emptyDescription ??
                    "Every scheduled instant of an active cron channel becomes a row here, written before the work starts and kept after it finishes."
                  }
                />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((o) => {
              const duration = serverSpan(o.started_at, o.completed_at)
              return (
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/schedules/occurrences/${o.id}`)}
                >
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={occurrenceStatusBadgeClass(o.status)}
                      title={occurrenceStatusLabel(o.status)}
                    >
                      {o.status}
                    </Badge>
                  </TableCell>
                  {showChannel && (
                    <TableCell className="font-medium">
                      <Link
                        to={`/channels/${o.channel_id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.channel_name}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant={o.trigger === "manual" ? "info" : "outline"} className="text-xs">
                      {o.trigger}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(o.scheduled_for)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {o.started_at ? formatDate(o.started_at) : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {duration == null ? "—" : formatDuration(duration)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {o.attempt}
                  </TableCell>
                  {onRetry && (
                    <TableCell className="text-right">
                      {isRetryable(o.status) && (
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={retryPending}
                          onClick={(e) => {
                            e.stopPropagation()
                            onRetry(o.id)
                          }}
                          title="Another attempt at this occurrence — same id, same scheduled_for"
                        >
                          <RotateCcw /> Retry
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
