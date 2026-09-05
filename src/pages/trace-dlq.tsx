import { useMemo, useState } from "react"
import { Link } from "react-router"
import {
  useTraceDlq,
  useTraceDlqEntry,
  useRequeueTraceDlq,
  useRequeueManyTraceDlq,
  usePurgeTraceDlq,
} from "@/hooks/use-trace-dlq"
import { useChannels } from "@/hooks/use-channels"
import type { Channel, TraceDlqSummary } from "@/api/types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { EmptyState } from "@/components/shared/empty-state"
import { JsonViewer } from "@/components/shared/json-viewer"
import { FilterBar } from "@/components/shared/filter-bar"
import { RetrySafetyWarning } from "@/components/shared/retry-safety-warning"
import { PAGE_SIZE, REGISTRY_LIMIT } from "@/lib/use-pagination"
import { useListState } from "@/lib/use-list-state"
import { formatDate, parseJson } from "@/lib/utils"
import { Inbox, RotateCcw, Trash2 } from "lucide-react"

/** An entry that has used up its retries: nothing will move it but a requeue. */
const isExhausted = (retryCount: number, maxRetries: number) => retryCount >= maxRetries

const FILTER_KEYS = ["channel", "exhausted"] as const

/** Distinct channels named in a bulk requeue whose retry guard is shown; the rest are counted. */
const GUARDS_SHOWN = 3

export function TraceDlqPage() {
  const { filters, update, offset, prev, next } = useListState(FILTER_KEYS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showPurge, setShowPurge] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  const { data, isLoading } = useTraceDlq({
    limit: PAGE_SIZE,
    offset,
    channel: filters.channel || undefined,
    exhausted: filters.exhausted === "" ? undefined : filters.exhausted === "true",
  })
  // The channel each entry belongs to: its page, and the workflow a requeue
  // would re-run. An entry names its channel by name.
  const { data: channelList } = useChannels({ limit: REGISTRY_LIMIT })
  const channelsByName = useMemo(
    () => new Map((channelList?.data ?? []).map((c) => [c.name, c])),
    [channelList?.data],
  )

  const requeue = useRequeueTraceDlq()
  const rows = data?.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trace DLQ"
        description="Async submissions that failed and are waiting on a retry"
      >
        <Button variant="outline" onClick={() => setShowBulk(true)} disabled={rows.length === 0}>
          <RotateCcw className="h-4 w-4" />
          Requeue all shown
        </Button>
        <Button variant="outline" onClick={() => setShowPurge(true)}>
          <Trash2 className="h-4 w-4" />
          Purge exhausted
        </Button>
      </PageHeader>

      <FilterBar>
        <Input
          value={filters.channel}
          onChange={(e) => update({ channel: e.target.value })}
          placeholder="Filter by channel"
          className="w-56"
          aria-label="Filter by channel"
        />
        <Select
          value={filters.exhausted}
          onChange={(e) => update({ exhausted: e.target.value })}
          aria-label="Filter by retry state"
          className="w-48"
        >
          <option value="">All entries</option>
          <option value="true">Exhausted only</option>
          <option value="false">Still retrying</option>
        </Select>
      </FilterBar>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Retries</TableHead>
              <TableHead>Next retry</TableHead>
              <TableHead>Failed at</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={Inbox}
                    title="Nothing in the dead-letter queue"
                    description="Only /async submissions reach this queue — a sync request carries its failure straight back to the caller, with nothing left to retry."
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const exhausted = isExhausted(row.retry_count, row.max_retries)
                const channel = channelsByName.get(row.channel)
                return (
                  <TableRow key={row.id} onActivate={() => setSelectedId(row.id)}>
                    <TableCell className="font-medium">
                      {channel ? (
                        <Link
                          to={`/channels/${channel.channel_id}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.channel}
                        </Link>
                      ) : (
                        row.channel
                      )}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-sm text-destructive" title={row.error_message}>
                      {row.error_message}
                    </TableCell>
                    <TableCell>
                      <Badge variant={exhausted ? "destructive" : "outline"}>
                        {row.retry_count}/{row.max_retries}
                        {exhausted ? " · exhausted" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {exhausted ? "—" : formatDate(row.next_retry_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.created_at)}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={requeue.isPending}
                        onClick={(e) => {
                          e.stopPropagation()
                          requeue.mutate(row.id)
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Requeue
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationFooter
        offset={offset}
        count={rows.length}
        total={data?.total}
        onPrev={prev}
        onNext={next}
      />

      {selectedId && (
        <DlqEntryDialog
          id={selectedId}
          channelsByName={channelsByName}
          onClose={() => setSelectedId(null)}
        />
      )}
      {showBulk && (
        <BulkRequeueDialog
          rows={rows}
          channelsByName={channelsByName}
          onClose={() => setShowBulk(false)}
        />
      )}
      {showPurge && <PurgeDialog onClose={() => setShowPurge(false)} />}
    </div>
  )
}

/** The payload lives only on the single-entry read — the list is payload-free. */
function DlqEntryDialog({
  id,
  channelsByName,
  onClose,
}: {
  id: string
  channelsByName: ReadonlyMap<string, Channel>
  onClose: () => void
}) {
  const { data, isLoading } = useTraceDlqEntry(id)
  const requeue = useRequeueTraceDlq()
  const channel = data ? channelsByName.get(data.channel) : undefined

  return (
    <Dialog open onClose={onClose} aria-label="DLQ entry">
      <DialogHeader>
        <DialogTitle>DLQ entry</DialogTitle>
      </DialogHeader>
      <DialogBody>
        {isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-4">
            <Card>
              <CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-2">
                <Field
                  label="Channel"
                  value={
                    channel ? (
                      <Link to={`/channels/${channel.channel_id}`} className="underline underline-offset-2">
                        {data.channel}
                      </Link>
                    ) : (
                      data.channel
                    )
                  }
                />
                <Field
                  label="Trace"
                  value={
                    <Link to={`/traces/${data.trace_id}`} className="font-mono text-xs underline">
                      {data.trace_id}
                    </Link>
                  }
                />
                <Field label="Retries" value={`${data.retry_count} / ${data.max_retries}`} />
                <Field label="Next retry" value={formatDate(data.next_retry_at)} />
              </CardContent>
            </Card>

            <Callout variant="destructive">
              <p className="mb-1 text-xs font-medium text-destructive">Error</p>
              <pre className="whitespace-pre-wrap font-mono text-xs text-destructive">
                {data.error_message}
              </pre>
            </Callout>

            {/* What a requeue would run twice. The catalogue's retry_safety is
                the witness; the decision stays with the operator. */}
            <RetrySafetyWarning workflowId={channel?.workflow_id} action="A requeue" />

            <JsonViewer data={parseJson(data.payload_json)} label="Failed payload" maxHeight="16rem" />
            <JsonViewer data={parseJson(data.metadata_json)} label="Metadata" maxHeight="12rem" />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={!data || requeue.isPending}
          onClick={() => data && requeue.mutate(data.id, { onSuccess: onClose })}
        >
          <RotateCcw className="h-4 w-4" /> Requeue
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Requeue every entry on the page — the move after a backend comes back. One
 * request per entry (there is no bulk route), and the retry guard for each
 * channel involved, since a requeue re-runs the workflow from the start.
 */
function BulkRequeueDialog({
  rows,
  channelsByName,
  onClose,
}: {
  rows: TraceDlqSummary[]
  channelsByName: ReadonlyMap<string, Channel>
  onClose: () => void
}) {
  const requeueMany = useRequeueManyTraceDlq()
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel))], [rows])
  const exhausted = rows.filter((r) => isExhausted(r.retry_count, r.max_retries)).length

  return (
    <Dialog open onClose={onClose} aria-label="Requeue every entry shown">
      <DialogHeader>
        <DialogTitle>Requeue {rows.length} {rows.length === 1 ? "entry" : "entries"}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Every entry on this page is scheduled for an immediate retry with its retry count reset
          {exhausted > 0 ? `, including ${exhausted} that had exhausted ${exhausted === 1 ? "its" : "their"} retries` : ""}
          . Across {channels.length} channel{channels.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono">{channels.slice(0, 6).join(", ")}</span>
          {channels.length > 6 ? ` and ${channels.length - 6} more` : ""}.
        </p>
        {channels.slice(0, GUARDS_SHOWN).map((name) => (
          <RetrySafetyWarning
            key={name}
            workflowId={channelsByName.get(name)?.workflow_id}
            action={`Requeuing ${name}`}
          />
        ))}
        {channels.length > GUARDS_SHOWN && (
          <p className="text-xs text-muted-foreground">
            The retry guard is shown for the first {GUARDS_SHOWN} channels; open an entry to see
            another channel's.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={requeueMany.isPending}>
          Cancel
        </Button>
        <Button
          disabled={requeueMany.isPending || rows.length === 0}
          onClick={() => requeueMany.mutate(rows.map((r) => r.id), { onSuccess: onClose })}
        >
          <RotateCcw className="h-4 w-4" />
          {requeueMany.isPending ? "Requeuing..." : `Requeue ${rows.length}`}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 sm:block">
      <span className="text-muted-foreground">{label}</span>
      <span className="sm:block">{value}</span>
    </div>
  )
}

function PurgeDialog({ onClose }: { onClose: () => void }) {
  const [hours, setHours] = useState("24")
  const purge = usePurgeTraceDlq()
  const parsed = Number(hours)
  const valid = hours.trim() !== "" && Number.isFinite(parsed) && parsed >= 0

  return (
    <Dialog open onClose={onClose} aria-label="Purge dead-letter queue">
      <DialogHeader>
        <DialogTitle>Purge exhausted entries</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted-foreground">
          Deletes only entries that have <strong>used up their retries</strong> and failed longer
          ago than the cut-off. Entries still scheduled for a retry are never purged.
        </p>
        <div className="space-y-1">
          <Label className="mb-0" htmlFor="purge-hours">
            Older than (hours)
          </Label>
          <Input
            id="purge-hours"
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          {parsed === 0 && valid && (
            <p className="text-xs text-destructive">
              0 purges every exhausted entry, regardless of age.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={purge.isPending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!valid || purge.isPending}
          onClick={() => purge.mutate({ older_than_hours: parsed }, { onSuccess: onClose })}
        >
          {purge.isPending ? "Purging..." : "Purge"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
