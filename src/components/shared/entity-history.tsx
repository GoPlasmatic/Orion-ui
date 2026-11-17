import { useState } from "react"
import { Link } from "react-router"
import { useDefinition } from "@/hooks/use-deployments"
import { useEntityHistory } from "@/hooks/use-registry"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState } from "@/components/shared/error-state"
import { JsonDiff } from "@/components/shared/json-diff"
import { shortDigest, type EntityHistoryEntry } from "@/lib/deployment-diff"
import type { DefinitionKind } from "@/api/types"

const stateKey = (e: Pick<EntityHistoryEntry, "revision" | "digest">) => `${e.revision}:${e.digest}`

/** "4, 5, 7" with each a link to that deployment revision. */
function DeploymentLinks({ revisions }: { revisions: number[] }) {
  const shown = revisions.slice(0, 8)
  return (
    <span className="font-mono text-xs">
      {shown.map((r, i) => (
        <span key={r}>
          {i > 0 && ", "}
          <Link to={`/deployments/${r}`} className="underline underline-offset-2">
            {r}
          </Link>
        </span>
      ))}
      {revisions.length > shown.length && <span className="text-muted-foreground"> +{revisions.length - shown.length}</span>}
    </span>
  )
}

/**
 * An entity's history across deployments: each state it was deployed in (its
 * member revision and definition digest) and the deployment revisions that
 * carried it — 1.x's version list, read from the manifests. Any two states
 * compare as a line diff of their stored definitions.
 */
export function EntityHistoryPanel({
  kind,
  id,
  current,
}: {
  kind: DefinitionKind
  id: string
  /** The state(s) the head deploys, marked as such. */
  current?: { revision: number; digest: string }[]
}) {
  const history = useEntityHistory({ kind, id })
  const [picked, setPicked] = useState<string[]>([])
  const entries = history.entries
  const isCurrent = (e: EntityHistoryEntry) => current?.some((c) => stateKey(c) === stateKey(e)) ?? false

  // Default compare: the newest state against the one before it.
  const pair = picked.length === 2 ? picked : entries.length >= 2 ? [stateKey(entries[1]), stateKey(entries[0])] : []
  const left = entries.find((e) => stateKey(e) === pair[0])
  const right = entries.find((e) => stateKey(e) === pair[1])

  const toggle = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev.slice(-1), key]))

  if (history.isLoading) return <Skeleton className="h-40 w-full" />
  if (history.error) return <ErrorState title="Could not read the deployment history" error={history.error} />

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each state this {kind} was deployed in, over the newest {history.oldestRead != null ? `deployments (back to revision ${history.oldestRead})` : "deployments"}
        {history.truncated ? "; older history is not read here" : ""}.
        {history.compacted > 0 &&
          ` ${history.compacted} of those revisions were compacted, so what they deployed cannot be shown.`}
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deployment in that window carries it.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Compare</span>
                </TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Definition</TableHead>
                <TableHead>Deployed in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => {
                const key = `${stateKey(e)}#${i}`
                const checked = pair.includes(stateKey(e))
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={checked}
                        onChange={() => toggle(stateKey(e))}
                        aria-label={`Compare revision ${e.revision}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      r{e.revision}
                      {isCurrent(e) && i === entries.findIndex((x) => stateKey(x) === stateKey(e)) && (
                        <Badge variant="outline" className="ml-2">
                          deployed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={e.digest}>
                      {shortDigest(e.digest)}
                    </TableCell>
                    <TableCell>
                      <DeploymentLinks revisions={e.deployments} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {left && right && left.digest !== right.digest && <StateDiff kind={kind} left={left} right={right} />}
      {left && right && left.digest === right.digest && (
        <p className="text-sm text-muted-foreground">
          r{left.revision} and r{right.revision} name the same definition ({shortDigest(left.digest)}): a renumbering,
          not a change.
        </p>
      )}
      {picked.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
          Compare the newest two
        </Button>
      )}
    </div>
  )
}

function StateDiff({
  kind,
  left,
  right,
}: {
  kind: DefinitionKind
  left: EntityHistoryEntry
  right: EntityHistoryEntry
}) {
  const before = useDefinition(left.digest)
  const after = useDefinition(right.digest)
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        r{left.revision} → r{right.revision}
      </h3>
      {before.isLoading || after.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : before.error || after.error ? (
        <ErrorState title={`Could not read a ${kind} definition`} error={before.error ?? after.error} />
      ) : (
        <JsonDiff before={before.data?.definition} after={after.data?.definition} />
      )}
    </div>
  )
}
