import { useState } from "react"
import { useNavigate } from "react-router"
import { useLintPackage, useUploadPackage } from "@/hooks/use-provider-packages"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { JsonEditor } from "@/components/shared/json-editor"
import { LintReport, PackageFileList, PackagePicker } from "@/components/packages/package-files"
import { describeFiles, type PackageFileEntry } from "@/lib/package-files"
import { describeError } from "@/lib/toast-error"
import type { PackageFiles } from "@/api/types"

/**
 * Upload a provider package: pick its folder (or start from files the studio
 * made), lint it, then store it — and, optionally, admit it in the same
 * request, against a provider lock when one is given. The server verifies
 * every digest and refuses a changed package under a published version.
 */
export function UploadPackageDialog({ onClose, initial }: { onClose: () => void; initial?: PackageFiles }) {
  const navigate = useNavigate()
  const [files, setFiles] = useState<PackageFiles | null>(initial ?? null)
  const [entries, setEntries] = useState<PackageFileEntry[]>(() => (initial ? describeFiles(initial) : []))
  const [admit, setAdmit] = useState(false)
  const [lock, setLock] = useState("")
  const lint = useLintPackage()
  const upload = useUploadPackage()
  const canMutate = useCanMutate()

  const lockError = (() => {
    if (!admit || !lock.trim()) return null
    try {
      JSON.parse(lock)
      return null
    } catch {
      return "The lock is not valid JSON"
    }
  })()

  const submit = () => {
    if (!files || lockError) return
    upload.mutate(
      { files, admit: admit || undefined, lock: admit && lock.trim() ? JSON.parse(lock) : undefined },
      {
        onSuccess: (res) => {
          onClose()
          navigate(`/provider-packages/${encodeURIComponent(res.package.digest)}`)
        },
      },
    )
  }

  return (
    <Dialog open onClose={onClose} className="max-w-2xl" aria-label="Upload a provider package">
      <DialogHeader>
        <DialogTitle>Upload a provider package</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A package is a folder: <code className="font-mono">connector.json</code>,{" "}
          <code className="font-mono">distribution.json</code>, its schemas and its implementation (workflows, or a
          WebAssembly component). Uploading stores it by digest; a connection may name it once it is admitted.
        </p>
        <PackagePicker
          onPicked={(f, e) => {
            setFiles(f)
            setEntries(e)
            lint.reset()
            upload.reset()
          }}
        />
        <PackageFileList entries={entries} />
        {files && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => lint.mutate(files)} disabled={lint.isPending}>
              {lint.isPending ? "Linting…" : "Lint"}
            </Button>
            <span className="text-xs text-muted-foreground">Checks the files without storing anything.</span>
          </div>
        )}
        {lint.data && <LintReport lint={lint.data} />}
        {lint.error && <Callout variant="destructive">{describeError(lint.error)}</Callout>}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={admit} onCheckedChange={setAdmit} aria-label="Admit it now" />
          Admit it now
        </label>
        {admit && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Optional: the provider lock the admission must verify against (JSON). Without one, the node&apos;s
              admission policy decides on the package alone.
            </p>
            <JsonEditor value={lock} onChange={setLock} height="8rem" aria-label="Provider lock" />
            {lockError && <p className="text-xs text-destructive">{lockError}</p>}
          </div>
        )}
        {upload.error && <Callout variant="destructive">{describeError(upload.error)}</Callout>}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={!files || upload.isPending || !!lockError || !canMutate}
          title={canMutate ? undefined : READ_ONLY_REASON}
        >
          {upload.isPending ? "Uploading…" : admit ? "Upload and admit" : "Upload"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
