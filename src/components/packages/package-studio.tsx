import { useState } from "react"
import { useLintPackage, usePackPackage, useScaffold } from "@/hooks/use-provider-packages"
import { useRuntimeCapabilities } from "@/hooks/use-runtime-capabilities"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { LintReport, PackageFileList, PackagePicker } from "@/components/packages/package-files"
import { UploadPackageDialog } from "@/components/packages/upload-dialog"
import { describeFiles, type PackageFileEntry } from "@/lib/package-files"
import { describeError } from "@/lib/toast-error"
import { downloadJson } from "@/lib/utils"
import { EDITION_TIERS, type EditionTier, type ImplementationKind, type PackageFiles } from "@/api/types"
import { Download, Upload, Wand2 } from "lucide-react"

const KINDS: { value: ImplementationKind; hint: string }[] = [
  { value: "workflow", hint: "Operations as hermetic workflows over the built-ins and other connections" },
  { value: "wasm", hint: "A WebAssembly component implementing orion:connector" },
  { value: "rust", hint: "A native driver an edition composes (the package describes it)" },
]

/**
 * The provider-package authoring tools, in the browser: scaffold a package,
 * lint its files, pack them to the digest an upload would get. Nothing is
 * stored; the server means a read-only key to be allowed all three (Orion
 * 2.0.0 still refuses them — its 403 renders like any refusal). Uploading the
 * result needs a full-access key.
 */
export function PackageStudio() {
  const runtime = useRuntimeCapabilities()
  const canMutate = useCanMutate()
  const scaffold = useScaffold()
  const lint = useLintPackage()
  const pack = usePackPackage()
  const [publisher, setPublisher] = useState("")
  const [providerId, setProviderId] = useState("")
  const [kind, setKind] = useState<ImplementationKind>("workflow")
  const [tier, setTier] = useState<EditionTier | "">("")
  const [version, setVersion] = useState("")
  const [files, setFiles] = useState<PackageFiles | null>(null)
  const [entries, setEntries] = useState<PackageFileEntry[]>([])
  const [shown, setShown] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const take = (f: PackageFiles, e: PackageFileEntry[] = describeFiles(f)) => {
    setFiles(f)
    setEntries(e)
    setShown(null)
    lint.reset()
    pack.reset()
  }

  const generate = () => {
    if (!publisher.trim() || !providerId.trim()) return
    scaffold.mutate(
      {
        publisher: publisher.trim(),
        provider_id: providerId.trim(),
        kind,
        tier: tier || undefined,
        version: version.trim() || undefined,
      },
      { onSuccess: (res) => take(res.files) },
    )
  }

  const edition = runtime.data?.edition

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Scaffold a package</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              generate()
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="studio-publisher" required>
                Publisher
              </Label>
              <Input id="studio-publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="acme" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="studio-provider" required>
                Provider id
              </Label>
              <Input
                id="studio-provider"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                placeholder="acme.billing"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="studio-kind">Implementation</Label>
              <Select id="studio-kind" value={kind} onChange={(e) => setKind(e.target.value as ImplementationKind)}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.value}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.value === kind)?.hint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="studio-tier">Tier</Label>
                <Select id="studio-tier" value={tier} onChange={(e) => setTier(e.target.value as EditionTier | "")}>
                  <option value="">community</option>
                  {EDITION_TIERS.filter((t) => t !== "community").map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="studio-version">Version</Label>
                <Input id="studio-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
              </div>
            </div>
            {tier && edition && EDITION_TIERS.indexOf(tier) > EDITION_TIERS.indexOf(edition) && (
              <p className="text-xs text-muted-foreground">
                This node is {edition}: it can store a {tier} package but not admit it.
              </p>
            )}
            <Button type="submit" disabled={scaffold.isPending || !publisher.trim() || !providerId.trim()}>
              <Wand2 className="h-4 w-4" /> {scaffold.isPending ? "Generating…" : "Generate"}
            </Button>
            {scaffold.error && <Callout variant="destructive">{describeError(scaffold.error)}</Callout>}
          </form>
          <div className="mt-6 space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Or open an existing package</p>
            <PackagePicker onPicked={(f, e) => take(f, e)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!files ? (
            <p className="text-sm text-muted-foreground">
              Generate a package or open one: its files appear here to lint, pack and upload.
            </p>
          ) : (
            <>
              <PackageFileList entries={entries} />
              <div className="flex flex-wrap gap-1">
                {entries
                  .filter((e) => e.encoding === "text")
                  .map((e) => (
                    <Button
                      key={e.path}
                      type="button"
                      size="xs"
                      variant={shown === e.path ? "default" : "outline"}
                      onClick={() => setShown(shown === e.path ? null : e.path)}
                    >
                      {e.path}
                    </Button>
                  ))}
              </div>
              {shown && files[shown] != null && (
                <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{prettyMaybe(files[shown])}</pre>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => lint.mutate(files)} disabled={lint.isPending}>
                  {lint.isPending ? "Linting…" : "Lint"}
                </Button>
                <Button type="button" variant="outline" onClick={() => pack.mutate(files)} disabled={pack.isPending}>
                  {pack.isPending ? "Packing…" : "Pack"}
                </Button>
                <Button type="button" variant="outline" onClick={() => downloadJson({ files }, "provider-package")}>
                  <Download className="h-4 w-4" /> Download files
                </Button>
                <Button
                  type="button"
                  onClick={() => setUploading(true)}
                  disabled={!canMutate}
                  title={canMutate ? "Store these files on the server" : READ_ONLY_REASON}
                >
                  <Upload className="h-4 w-4" /> Upload…
                </Button>
              </div>
              {lint.data && <LintReport lint={lint.data} />}
              {lint.error && <Callout variant="destructive">{describeError(lint.error)}</Callout>}
              {pack.data && (
                <Callout variant="info">
                  Packs to <span className="font-mono">{pack.data.package_digest}</span> — the digest an upload of these
                  files gets, with <code className="font-mono">inventory.json</code> written.{" "}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => take(pack.data.files)}
                  >
                    Use the packed files
                  </button>
                </Callout>
              )}
              {pack.error && <Callout variant="destructive">{describeError(pack.error)}</Callout>}
            </>
          )}
        </CardContent>
      </Card>

      {uploading && files && <UploadPackageDialog initial={files} onClose={() => setUploading(false)} />}
    </div>
  )
}

/** JSON files are minified on the wire; show them indented. */
function prettyMaybe(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
