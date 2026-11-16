import { Fragment, useMemo, useState } from "react"
import { hasDefinition, useDefinition } from "@/hooks/use-deployments"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { JsonDiff } from "@/components/shared/json-diff"
import { JsonViewer } from "@/components/shared/json-viewer"
import { RolloutBar } from "@/components/deployments/rollout-bar"
import {
  diffManifests,
  diffSentence,
  memberKey,
  refLabel,
  shortDigest,
  summarizeDiff,
  type ChangedField,
  type MemberChange,
} from "@/lib/deployment-diff"
import type { ManifestMember } from "@/api/types"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight } from "lucide-react"

const CHANGE_CLASS: Record<MemberChange["change"], string> = {
  added: "border-success/40 text-success",
  removed: "border-destructive/40 text-destructive",
  updated: "border-warning/40 text-warning",
}

const FIELD_WORDS: Record<ChangedField, string> = {
  revision: "renumbered",
  definition: "definition",
  requires: "requires",
  rollouts: "rollout",
}

/**
 * What `after` changes against `before`: members added (they start serving),
 * removed (they stop), and changed. A changed member opens to a line diff of
 * its two definitions; a connection, which names a configuration digest
 * rather than a definition, shows the two digests.
 */
export function RevisionChanges({
  before,
  after,
  emptyText = "No member differs.",
}: {
  before: ManifestMember[] | undefined
  after: ManifestMember[]
  emptyText?: string
}) {
  const changes = useMemo(() => diffManifests(before, after), [before, after])
  const [open, setOpen] = useState<string | null>(null)

  if (changes.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{diffSentence(summarizeDiff(changes))}</p>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Change</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Revision</TableHead>
              <TableHead>What</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((c) => {
              const key = memberKey(c)
              const isOpen = open === key
              return (
                <Fragment key={key}>
                  <TableRow onActivate={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                    <TableCell className="text-muted-foreground">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={CHANGE_CLASS[c.change]}>
                        {c.change === "updated" ? "changed" : c.change}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{c.kind}</span> <span className="font-medium">{c.id}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.change === "added"
                        ? `r${c.after!.entity.revision}`
                        : c.change === "removed"
                          ? `r${c.before!.entity.revision}`
                          : c.before!.entity.revision === c.after!.entity.revision
                            ? `r${c.after!.entity.revision}`
                            : `r${c.before!.entity.revision} → r${c.after!.entity.revision}`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.change === "added"
                        ? "starts serving"
                        : c.change === "removed"
                          ? "stops serving"
                          : c.fields.map((f) => FIELD_WORDS[f]).join(", ")}
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="bg-muted/30 py-3">
                        <ChangeDetail change={c} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function ChangeDetail({ change }: { change: MemberChange }) {
  const definable = hasDefinition(change.kind)
  const before = useDefinition(change.before?.definition_digest, definable)
  const after = useDefinition(change.after?.definition_digest, definable)
  const b = change.before
  const a = change.after
  const workflow = (a ?? b)?.requires?.find((r) => r.kind === "workflow")?.id ?? change.id

  return (
    <div className="space-y-3">
      {change.fields.includes("requires") && (
        <p className="text-xs text-muted-foreground">
          Requires {(b?.requires ?? []).map(refLabel).join(", ") || "nothing"} →{" "}
          {(a?.requires ?? []).map(refLabel).join(", ") || "nothing"}.
        </p>
      )}
      {change.fields.includes("rollouts") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Before</p>
            {b?.rollouts?.length ? <RolloutBar rollouts={b.rollouts} workflow={workflow} /> : <p className="text-xs">one workflow, all traffic</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">After</p>
            {a?.rollouts?.length ? <RolloutBar rollouts={a.rollouts} workflow={workflow} /> : <p className="text-xs">one workflow, all traffic</p>}
          </div>
        </div>
      )}
      {!definable ? (
        <p className={cn("text-sm text-muted-foreground")}>
          Connection configuration {b ? shortDigest(b.definition_digest) : "—"} → {a ? shortDigest(a.definition_digest) : "—"}.
        </p>
      ) : (change.change !== "updated" || change.fields.includes("definition")) &&
        ((b && before.isLoading) || (a && after.isLoading)) ? (
        <Skeleton className="h-32 w-full" />
      ) : change.change === "added" ? (
        <JsonViewer data={after.data?.definition} label="Definition" maxHeight="24rem" />
      ) : change.change === "removed" ? (
        <JsonViewer data={before.data?.definition} label="Definition it served" maxHeight="24rem" />
      ) : change.fields.includes("definition") ? (
        <JsonDiff before={before.data?.definition} after={after.data?.definition} />
      ) : (
        <p className="text-xs text-muted-foreground">The definition is unchanged ({shortDigest(a!.definition_digest)}).</p>
      )}
    </div>
  )
}
