import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import { enabledBadgeClass } from "@/lib/status"
import type { ImportOptions, ImportResult, OnConflict } from "@/api/types"

const CONFLICT_MODES: { value: OnConflict; label: string; hint: string }[] = [
  { value: "fail", label: "Fail on conflict", hint: "An already-stored item is refused." },
  { value: "skip", label: "Skip conflicts", hint: "An already-stored item is left alone." },
  {
    value: "new_version",
    label: "Upsert (new version)",
    hint: "A draft is updated in place; an active entity whose content differs gets a new draft version. Re-importing an unchanged artifact writes nothing.",
  },
]

interface ImportDialogProps {
  title: string
  onImport: (items: unknown[], opts: ImportOptions) => Promise<ImportResult>
  onClose: () => void
}

export function ImportDialog({ title, onImport, onClose }: ImportDialogProps) {
  const [text, setText] = useState("[\n  \n]")
  const [onConflict, setOnConflict] = useState<OnConflict>("fail")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (dryRun: boolean) => {
    setError(null)
    setResult(null)
    let items: unknown
    try {
      items = JSON.parse(text)
    } catch {
      setError("Invalid JSON")
      return
    }
    if (!Array.isArray(items)) {
      setError("Expected a JSON array of items")
      return
    }
    if (items.length > 1000) {
      setError(`${items.length} items — the server accepts at most 1000 per request. Split the bundle.`)
      return
    }
    setBusy(true)
    try {
      setResult(await onImport(items, { dryRun, onConflict }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setBusy(false)
    }
  }

  const conflictHint = CONFLICT_MODES.find((m) => m.value === onConflict)?.hint

  return (
    <Dialog open onClose={onClose} aria-label={title}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
          <p className="text-sm text-muted-foreground">
            Paste a JSON array of items (at most 1000). Validate runs a dry run: nothing is
            written, and conflicts against stored rows are reported exactly as a real import
            would resolve them.
          </p>

          <div className="space-y-1">
            <Label className="mb-0" htmlFor="import-on-conflict">
              On conflict
            </Label>
            <Select
              id="import-on-conflict"
              value={onConflict}
              onChange={(e) => setOnConflict(e.target.value as OnConflict)}
            >
              {CONFLICT_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            {conflictHint && <p className="text-xs text-muted-foreground">{conflictHint}</p>}
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />

          {error && (
            <Callout variant="destructive">
              {error}
            </Callout>
          )}

          {result && <ImportSummary result={result} />}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button variant="outline" onClick={() => run(true)} disabled={busy}>
          Validate
        </Button>
        <Button onClick={() => run(false)} disabled={busy}>
          {busy ? "Working..." : "Import"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Since 1.0 a dry run reports in the same fields as a real run, so one renderer
 * covers both. `failed` is non-zero with a 200 — the status never carries it.
 */
export function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {result.dry_run && <Badge variant="secondary">Dry run</Badge>}
        <Badge variant="outline" className={enabledBadgeClass}>
          {result.imported} {result.dry_run ? "would import" : "imported"}
        </Badge>
        {result.unchanged > 0 && (
          <Badge variant="outline">{result.unchanged} unchanged</Badge>
        )}
        {result.skipped > 0 && <Badge variant="outline">{result.skipped} skipped</Badge>}
        {result.failed > 0 && <Badge variant="destructive">{result.failed} failed</Badge>}
      </div>

      {result.errors.length > 0 && (
        <ul className="space-y-1 text-xs">
          {result.errors.map((e) => (
            <li key={e.index} className="font-mono text-destructive">
              [{e.index}] {e.error}
            </li>
          ))}
        </ul>
      )}

      {result.results.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
          {result.results.map((r) => (
            <li key={r.index} className="font-mono">
              [{r.index}] {r.id ?? "—"} · {r.action}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
