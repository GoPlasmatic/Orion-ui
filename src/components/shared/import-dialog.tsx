import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import type { ImportResult } from "@/api/types"

interface ImportDialogProps {
  title: string
  /** Calls the import endpoint; dryRun=true previews without persisting. */
  onImport: (items: unknown[], dryRun: boolean) => Promise<ImportResult>
  onClose: () => void
}

export function ImportDialog({ title, onImport, onClose }: ImportDialogProps) {
  const [text, setText] = useState("[\n  \n]")
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
    setBusy(true)
    try {
      setResult(await onImport(items, dryRun))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="flex max-h-[90vh] w-full max-w-2xl flex-col">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Paste a JSON array of items. Validate runs a dry-run (no database writes,
            so name conflicts are not detected until you import).
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {result.dry_run && <Badge variant="secondary">Dry run</Badge>}
                {result.would_create !== undefined && (
                  <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                    {result.would_create} would create
                  </Badge>
                )}
                {!result.dry_run && (
                  <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                    {result.imported} imported
                  </Badge>
                )}
                {(result.would_fail ?? result.failed) > 0 && (
                  <Badge variant="destructive">
                    {result.would_fail ?? result.failed} failed
                  </Badge>
                )}
              </div>
              {result.errors.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {result.errors.map((e) => (
                    <li key={e.index} className="font-mono text-red-600">
                      [{e.index}] {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button variant="outline" onClick={() => run(true)} disabled={busy}>
            Validate
          </Button>
          <Button onClick={() => run(false)} disabled={busy}>
            {busy ? "Working..." : "Import"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
