import { useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { readPackageFiles, type PackageFileEntry } from "@/lib/package-files"
import { formatBytes } from "@/lib/utils"
import type { LintResponse, PackageFiles } from "@/api/types"
import { FileUp, FolderUp } from "lucide-react"

/**
 * Pick a provider package from disk — a folder (its files keep their paths)
 * or loose files — and hand back the wire's `files` map. Text stays text;
 * anything else (a component) travels as `base64:`.
 */
export function PackagePicker({ onPicked }: { onPicked: (files: PackageFiles, entries: PackageFileEntry[]) => void }) {
  const folder = useRef<HTMLInputElement>(null)
  const loose = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const read = async (list: FileList | null) => {
    setError(null)
    if (!list || list.length === 0) return
    try {
      const { files, entries } = await readPackageFiles([...list])
      onPicked(files, entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the files")
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => folder.current?.click()}>
          <FolderUp className="h-4 w-4" /> Choose a folder
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => loose.current?.click()}>
          <FileUp className="h-4 w-4" /> Choose files
        </Button>
      </div>
      <input
        ref={folder}
        type="file"
        className="hidden"
        aria-label="Package folder"
        // Folder selection: not in the DOM typings, but every current browser takes it.
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        multiple
        onChange={(e) => void read(e.target.files)}
      />
      <input
        ref={loose}
        type="file"
        className="hidden"
        aria-label="Package files"
        multiple
        onChange={(e) => void read(e.target.files)}
      />
      {error && <Callout variant="destructive">{error}</Callout>}
    </div>
  )
}

/** The files a package carries, with size and how each travels. */
export function PackageFileList({ entries }: { entries: PackageFileEntry[] }) {
  if (entries.length === 0) return null
  return (
    <ul className="max-h-56 space-y-0.5 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">
      {entries.map((e) => (
        <li key={e.path} className="flex items-center justify-between gap-3">
          <span className="truncate font-mono">{e.path}</span>
          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
            {e.encoding === "base64" && (
              <Badge variant="outline" className="text-[10px]">
                binary
              </Badge>
            )}
            {formatBytes(e.size)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A lint report: valid, or each problem as the linter names it (`CODE: where`). */
export function LintReport({ lint }: { lint: LintResponse }) {
  return lint.valid ? (
    <Callout variant="success">
      Lint passed{lint.provider_id ? ` — ${lint.provider_id}` : ""}
      {lint.version ? ` ${lint.version}` : ""}
      {lint.implementation ? ` (${lint.implementation})` : ""}.
    </Callout>
  ) : (
    <Callout variant="destructive">
      <p className="font-medium">
        {lint.errors.length} problem{lint.errors.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-xs">
        {lint.errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </Callout>
  )
}
