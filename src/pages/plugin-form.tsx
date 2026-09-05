import { useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import {
  usePlugin,
  useCreatePlugin,
  useUpdatePlugin,
  useValidatePlugin,
} from "@/hooks/use-plugins"
import { useHealth } from "@/hooks/use-health"
import type {
  CreatePluginRequest,
  Plugin,
  PluginManifest,
  UpdatePluginRequest,
  ValidationResponse,
} from "@/api/types"
import { useUnsavedChanges } from "@/lib/use-unsaved-changes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { FormError } from "@/components/shared/form-error"
import { TagsInput } from "@/components/shared/tags-input"
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog"
import { ValidationResults } from "@/components/shared/validation-results"
import { Save, ShieldCheck, Trash2 } from "lucide-react"

const SAMPLE_MANIFEST = `abi = "orion:plugin@1.0.0"
name = "acme.codec"
version = "0.1.0"

[[functions]]
name = "acme.codec.parse"
description = "Parse a record into JSON"
category = "transform"
output_default_root = "data"

[[functions.input_fields]]
name = "record"
kind = "string"
required = true
resolvable = true
`

/** What the manifest text says about itself, before Validate: which syntax, which plugin, which functions. */
interface ManifestSummary {
  kind: "empty" | "json" | "toml"
  name?: string
  version?: string
  functions: string[]
  /** Something the server will refuse, said now rather than after a round trip. */
  problem?: string
}

/**
 * A light read of the manifest as typed. JSON is parsed; TOML is scanned for
 * its tables rather than parsed — the server owns the grammar, this only
 * answers "did the text I pasted come through as I meant it". A blank name
 * in a `[[functions]]` table or no table at all is the mistake worth catching
 * before the upload.
 */
function summariseManifest(text: string): ManifestSummary {
  const trimmed = text.trim()
  if (!trimmed) return { kind: "empty", functions: [] }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as PluginManifest
      const fns = Array.isArray(parsed.functions) ? parsed.functions : []
      const names = fns.map((f) => (f && typeof f === "object" && typeof f.name === "string" ? f.name : "")).filter(Boolean)
      return {
        kind: "json",
        name: typeof parsed.name === "string" ? parsed.name : undefined,
        version: typeof parsed.version === "string" ? parsed.version : undefined,
        functions: names,
        problem:
          typeof parsed !== "object" || Array.isArray(parsed)
            ? "A JSON manifest must be an object"
            : names.length === 0
              ? "No `functions` entry names a function"
              : undefined,
      }
    } catch (e) {
      return { kind: "json", functions: [], problem: `Looks like JSON but does not parse: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  // TOML: top-level keys before the first table, then a name per [[functions]] table.
  let table = ""
  let name: string | undefined
  let version: string | undefined
  const functions: string[] = []
  let tables = 0
  for (const raw of trimmed.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const header = /^\[\[?\s*([A-Za-z0-9_.-]+)\s*\]\]?$/.exec(line)
    if (header) {
      table = header[1]
      if (line.startsWith("[[") && table === "functions") tables++
      continue
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/.exec(line)
    if (!kv) continue
    if (table === "" && kv[1] === "name") name = kv[2]
    else if (table === "" && kv[1] === "version") version = kv[2]
    else if (table === "functions" && kv[1] === "name") functions.push(kv[2])
  }
  return {
    kind: "toml",
    name,
    version,
    functions,
    problem:
      tables === 0
        ? "No [[functions]] table — the server refuses a manifest that declares no function"
        : functions.length < tables
          ? "A [[functions]] table has no name"
          : undefined,
  }
}

/** Base64 without the call-stack limit `String.fromCharCode(...bytes)` hits on a real component. */
function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** `sha256:<hex>` over the bytes — the identity the server will assign, computed here to compare. */
async function digestOf(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer)
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `sha256:${hex}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

interface ComponentFile {
  name: string
  size: number
  base64: string
  digest: string
}

/**
 * Upload a plugin (or edit a draft): a manifest — TOML text or the manifest as
 * a JSON object, sent as whichever the text parses to — plus the component as
 * base64. The server validates, hashes, compiles and probes it before the
 * draft exists, so Validate answers exactly what Save would.
 */
function PluginForm({ existing }: { existing?: Plugin }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createPlugin = useCreatePlugin()
  const updatePlugin = useUpdatePlugin()
  const validatePlugin = useValidatePlugin()
  const { data: health } = useHealth()

  const [manifestText, setManifestText] = useState(() =>
    existing ? JSON.stringify(existing.manifest, null, 2) : SAMPLE_MANIFEST
  )
  const [component, setComponent] = useState<ComponentFile | null>(null)
  const [digest, setDigest] = useState("")
  const [signature, setSignature] = useState(existing?.signature ?? "")
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState<ValidationResponse | null>(null)
  const [reading, setReading] = useState(false)

  const snapshot = JSON.stringify({ manifestText, component: component?.digest, digest, signature, tags })
  const summary = useMemo(() => summariseManifest(manifestText), [manifestText])
  const [initialSnapshot] = useState(snapshot)
  const { blocker, markSaved } = useUnsavedChanges(snapshot !== initialSnapshot)

  const backTo = existing ? `/plugins/${encodeURIComponent(existing.plugin_id)}` : "/plugins"
  const editLocked = existing ? existing.status !== "draft" : false
  const sandboxOff = health?.components?.plugins === "disabled"

  const onFile = async (file: File | undefined) => {
    if (!file) {
      setComponent(null)
      return
    }
    setReading(true)
    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      setComponent({
        name: file.name,
        size: bytes.length,
        base64: toBase64(bytes),
        digest: await digestOf(buffer),
      })
      setDigest("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the component")
    } finally {
      setReading(false)
    }
  }

  /** The manifest as the server accepts it: a JSON object, or the TOML text verbatim. */
  const parseManifest = (): string | PluginManifest | null => {
    const text = manifestText.trim()
    if (!text) {
      setError("A manifest is required")
      return null
    }
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setError("A JSON manifest must be an object")
        return null
      }
      return parsed as PluginManifest
    } catch {
      // Not JSON: the server parses it as TOML.
      return text
    }
  }

  const buildPayload = (): CreatePluginRequest | null => {
    const manifest = parseManifest()
    if (manifest === null) return null
    const payload: CreatePluginRequest = { manifest, tags }
    if (component) payload.component = component.base64
    else if (digest.trim()) payload.digest = digest.trim()
    else if (!isEdit) {
      setError("Choose the component file, or name the digest of one this instance already holds")
      return null
    }
    if (signature.trim()) payload.signature = signature.trim()
    return payload
  }

  const handleValidate = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    // Validating a draft edit with no new component: name the stored digest so
    // the check runs against the artifact the draft actually has.
    if (isEdit && !payload.component && !payload.digest) payload.digest = existing!.digest
    validatePlugin.mutate(payload, {
      onSuccess: setValidation,
      onError: setError,
    })
  }

  const handleSubmit = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    if (existing) {
      const req: UpdatePluginRequest = {
        manifest: payload.manifest,
        component: payload.component,
        digest: payload.digest,
        signature: payload.signature,
        tags: payload.tags,
      }
      updatePlugin.mutate(
        { id: existing.plugin_id, req },
        {
          onSuccess: () => {
            markSaved()
            navigate(backTo)
          },
          onError: setError,
        }
      )
    } else {
      createPlugin.mutate(payload, {
        onSuccess: (p) => {
          markSaved()
          navigate(`/plugins/${encodeURIComponent(p.plugin_id)}`)
        },
        onError: setError,
      })
    }
  }

  const isPending = createPlugin.isPending || updatePlugin.isPending

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Plugins", to: "/plugins" },
          ...(existing ? [{ label: existing.plugin_id, to: backTo }] : []),
          { label: isEdit ? "Edit" : "Upload" },
        ]}
      />

      <PageHeader
        title={isEdit ? "Edit Plugin" : "Upload Plugin"}
        description={
          isEdit
            ? "Replace the draft's manifest, component or tags; an untouched field keeps its value"
            : "A manifest and a WebAssembly component; saved as a draft until activated"
        }
      />

      {sandboxOff && (
        <Callout variant="warning" className="max-w-3xl">
          The plugin sandbox is off on this node, so the upload will be refused with 400. Turn on{" "}
          <code className="font-mono">plugins.enabled</code> — on every node — first.
        </Callout>
      )}
      {editLocked && (
        <Callout variant="warning" className="max-w-3xl">
          Only drafts can be edited. Create a new version from the plugin detail page first.
        </Callout>
      )}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Plugin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label
              required
              hint="TOML as the CLI writes it, or the same document as a JSON object. The manifest's `name` is the plugin id."
            >
              Manifest
            </Label>
            <Textarea
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
              rows={16}
              className="font-mono text-sm"
              aria-label="Plugin manifest"
            />
            {summary.kind !== "empty" && (
              <p className={`mt-1 text-xs ${summary.problem ? "text-warning" : "text-muted-foreground"}`}>
                {summary.kind === "json" ? "JSON" : "TOML"} manifest
                {summary.name ? ` · ${summary.name}${summary.version ? ` v${summary.version}` : ""}` : " · no name yet"}
                {summary.functions.length > 0
                  ? ` · ${summary.functions.length} function${summary.functions.length === 1 ? "" : "s"}: ${summary.functions.join(", ")}`
                  : ""}
                {summary.problem ? ` — ${summary.problem}` : ""}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Every function must be named <code className="font-mono">{"<name>.<label>"}</code>;
              a field is evaluated (<code className="font-mono">template_at</code>), folded (
              <code className="font-mono">resolvable</code>) or literal. A{" "}
              <code className="font-mono">{"{\"secret\": …}"}</code> node is refused anywhere in a
              plugin task's input — a plugin never sees key material.
            </p>
          </div>

          <div>
            <Label required={!isEdit} hint="A WebAssembly component targeting orion:plugin@1.0.0 (wasm32-unknown-unknown, componentised with wasm-tools).">
              Component
            </Label>
            <Input
              type="file"
              accept=".wasm,application/wasm"
              onChange={(e) => onFile(e.target.files?.[0])}
              aria-label="Component file"
            />
            {reading && <p className="mt-1 text-xs text-muted-foreground">Reading…</p>}
            {component && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{component.name}</span>
                <span className="text-muted-foreground">{formatBytes(component.size)}</span>
                <span className="font-mono text-muted-foreground" title="Computed here — the server assigns the same digest">
                  {component.digest}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setComponent(null)}
                >
                  <Trash2 /> Clear
                </Button>
              </div>
            )}
            {isEdit && !component && (
              <p className="mt-1 text-xs text-muted-foreground">
                Leave empty to keep the stored component{" "}
                <span className="font-mono">{existing!.digest.slice(0, 19)}…</span>
              </p>
            )}
          </div>

          {!component && (
            <div>
              <Label hint="Instead of a file: the sha256 of a component this instance already holds, as an export without artifacts names it.">
                Digest
              </Label>
              <Input
                value={digest}
                onChange={(e) => setDigest(e.target.value)}
                placeholder="sha256:…"
                className="font-mono"
                aria-label="Component digest"
              />
            </div>
          )}

          <div>
            <Label hint="Detached Ed25519 signature over the digest string, base64. Required when the node's [plugins.trust] names keys; stored but unchecked otherwise.">
              Signature
            </Label>
            <Input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="font-mono"
              aria-label="Signature"
            />
          </div>

          <div>
            <Label>Tags</Label>
            <TagsInput value={tags} onChange={setTags} placeholder="codecs, billing" aria-label="Tags" />
          </div>

          {validation && <ValidationResults result={validation} validLabel="Plugin is valid on this node." />}

          <FormError error={error} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button variant="outline" onClick={handleValidate} disabled={validatePlugin.isPending || reading}>
              <ShieldCheck className="h-4 w-4" />
              {validatePlugin.isPending ? "Validating..." : "Validate"}
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || editLocked || reading}>
              <Save className="h-4 w-4" />
              {isPending ? "Saving..." : isEdit ? "Save Draft" : "Upload as Draft"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

export function PluginFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data: existing, isLoading } = usePlugin(id ?? "")

  if (id && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full max-w-3xl" />
      </div>
    )
  }

  return <PluginForm key={existing?.plugin_id ?? "new"} existing={id ? existing : undefined} />
}
