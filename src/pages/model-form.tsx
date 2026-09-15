import { useCallback, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useModel, useCreateModel, useUpdateModel, useValidateModel } from "@/hooks/use-models"
import { useHealth } from "@/hooks/use-health"
import type {
  CreateModelRequest,
  Model,
  ModelManifest,
  ModelValidationResponse,
  UpdateModelRequest,
} from "@/api/types"
import type { Diagnostic, LintContext } from "@/lib/editor-types"
import { useUnsavedChanges } from "@/lib/use-unsaved-changes"
import { blankManifest, lintManifest } from "@/lib/model-manifest"
import { positionIssues, toDiagnostics } from "@/lib/json-path"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { ConnectorField } from "@/components/shared/config-field"
import { FormError } from "@/components/shared/form-error"
import { JsonEditor } from "@/components/shared/json-editor"
import { TagsInput } from "@/components/shared/tags-input"
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog"
import { ValidationResults } from "@/components/shared/validation-results"
import { Save, ShieldCheck } from "lucide-react"

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Register a model (or edit a draft): the `orion:model@1.0.0` manifest, and an
 * artifact *reference* — a storage connector, an object key, and the digest
 * the bytes must hash to. Nothing is uploaded; the node fetches the object
 * itself at admission, which is why the connector has to exist here and on
 * every instance the model is promoted to.
 *
 * The manifest is authored as JSON rather than through a field-by-field form:
 * its adapters *are* JSONLogic, and a manifest generally arrives beside the
 * artifact from whatever trained it. The lint mirrors the server's
 * `model/manifest.rs` so the round trip is for the things only the server can
 * answer — does the object exist, does the graph match what was declared.
 */
function ModelForm({ existing }: { existing?: Model }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createModel = useCreateModel()
  const updateModel = useUpdateModel()
  const validateModel = useValidateModel()
  const { data: health } = useHealth()

  const [manifestText, setManifestText] = useState(() =>
    JSON.stringify(existing?.manifest ?? blankManifest(), null, 2),
  )
  const [connector, setConnector] = useState(existing?.artifact.connector ?? "")
  const [key, setKey] = useState(existing?.artifact.key ?? "")
  const [digest, setDigest] = useState(existing?.artifact.digest ?? "")
  const [signature, setSignature] = useState(existing?.signature ?? "")
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState<ModelValidationResponse | null>(null)

  const snapshot = JSON.stringify({ manifestText, connector, key, digest, signature, tags })
  const [initialSnapshot] = useState(snapshot)
  const { blocker, markSaved } = useUnsavedChanges(snapshot !== initialSnapshot)

  const backTo = existing ? `/models/${encodeURIComponent(existing.model_id)}` : "/models"
  const editLocked = existing ? existing.status !== "draft" : false
  const runtimeOff = health?.components?.models === "disabled"

  /** The manifest's own rules, at the coordinate the author typed. */
  const lint = useCallback(({ doc, tree, syntaxErrors }: LintContext): Diagnostic[] => {
    // A document that does not parse has nothing to check against the manifest
    // rules, and the parser has already said where.
    if (syntaxErrors.length > 0) return syntaxErrors
    let parsed: unknown
    try {
      parsed = JSON.parse(doc)
    } catch {
      return syntaxErrors
    }
    return toDiagnostics(positionIssues(lintManifest(parsed), tree, doc))
  }, [])

  const buildPayload = (): CreateModelRequest | null => {
    let manifest: ModelManifest
    try {
      const parsed: unknown = JSON.parse(manifestText)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setError("The manifest must be a JSON object")
        return null
      }
      manifest = parsed as ModelManifest
    } catch (e) {
      setError(`The manifest does not parse: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
    if (!connector) {
      setError("Choose the storage connector the artifact is read through")
      return null
    }
    if (!key.trim()) {
      setError("Name the object key within that connector's bucket")
      return null
    }
    const trimmedDigest = digest.trim()
    if (!DIGEST_RE.test(trimmedDigest)) {
      setError(
        "The digest must be `sha256:` followed by 64 lowercase hex characters — the output of `shasum -a 256 <file>`",
      )
      return null
    }
    const payload: CreateModelRequest = {
      manifest,
      artifact: { connector, key: key.trim(), digest: trimmedDigest },
      tags,
    }
    if (signature.trim()) payload.signature = signature.trim()
    return payload
  }

  const handleValidate = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    validateModel.mutate(payload, { onSuccess: setValidation, onError: setError })
  }

  const handleSubmit = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    if (existing) {
      const req: UpdateModelRequest = {
        manifest: payload.manifest,
        artifact: payload.artifact,
        signature: payload.signature,
        tags: payload.tags,
      }
      updateModel.mutate(
        { id: existing.model_id, req },
        {
          onSuccess: () => {
            markSaved()
            navigate(backTo)
          },
          onError: setError,
        },
      )
    } else {
      createModel.mutate(payload, {
        onSuccess: (m) => {
          markSaved()
          navigate(`/models/${encodeURIComponent(m.model_id)}`)
        },
        onError: setError,
      })
    }
  }

  const isPending = createModel.isPending || updateModel.isPending
  const head = validation?.head

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Models", to: "/models" },
          ...(existing ? [{ label: existing.model_id, to: backTo }] : []),
          { label: isEdit ? "Edit" : "Register" },
        ]}
      />
      <PageHeader
        title={existing ? `Edit ${existing.model_id}` : "Register Model"}
        description={
          isEdit
            ? "Only a draft can be edited; a changed artifact reference queues admission again"
            : "The manifest and where the bytes are — the server fetches them itself"
        }
      />

      {runtimeOff && (
        <Callout variant="info">
          The model runtime is off on this node (<code className="font-mono">models.enabled =
          false</code>), so registering answers <code className="font-mono">400</code> and Validate
          reports it as the one finding. The form still works against a node that has it on.
        </Callout>
      )}
      {editLocked && existing && (
        <Callout variant="warning">
          This version is {existing.status}, and only a draft can be edited. Create a new version
          from the model's page to change it.
        </Callout>
      )}

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Manifest</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Declares the model's id, every input and output the graph has — name, dtype and shape —
            and the JSONLogic that marshals a message into those tensors and the outputs back out.
            Leave an <code className="font-mono">adapter</code> or the{" "}
            <code className="font-mono">result</code> out and the default applies, which is enough
            for a caller that already speaks tensors. An adapter may not read{" "}
            <code className="font-mono">{`{"secret": …}`}</code>,{" "}
            <code className="font-mono">now</code> or <code className="font-mono">random</code>.
          </p>
          <p className="text-sm text-muted-foreground">
            A dimension is a positive count or a <strong>name</strong> —{" "}
            <code className="font-mono">{`"shape": ["N", 3]`}</code> — for a graph exported with a
            dynamic axis. The name binds to what each call brings, and one session serves every
            size. Name the same axis in an output and it means the one the input bound. Admission
            needs concrete tensors, so{" "}
            <code className="font-mono">probe_dims</code> says what to probe each name at; a name
            it leaves out is probed at 1.
          </p>
          <JsonEditor
            value={manifestText}
            onChange={setManifestText}
            lint={lint}
            height="26rem"
            readOnly={editLocked}
            aria-label="Model manifest"
          />
        </CardContent>
      </Card>

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Artifact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Where the bytes are. The row carries the reference and never the artifact, so an export,
            a package and an audit row all stay small and the bucket stays the one place the model
            is kept.
          </p>

          <ConnectorField
            label="Storage connector"
            value={connector || undefined}
            onChange={(v) => setConnector(v ?? "")}
            types={["storage"]}
            includeEmpty="Choose a connector"
          />

          <div>
            <Label required hint="The object key within that connector's bucket.">
              Object key
            </Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="c4-tiny.onnx"
              className="font-mono"
              aria-label="Object key"
            />
          </div>

          <div>
            <Label
              required
              hint="The sha256 the bytes must hash to. Admission verifies it, and no node will serve an artifact that does not match."
            >
              Digest
            </Label>
            <Input
              value={digest}
              onChange={(e) => setDigest(e.target.value)}
              placeholder="sha256:…"
              className="font-mono"
              aria-label="Artifact digest"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              <code className="font-mono">shasum -a 256 model.onnx</code> — prefix the hex with{" "}
              <code className="font-mono">sha256:</code>
            </p>
          </div>

          <div>
            <Label hint="Detached Ed25519 signature over the digest string, base64. Required when the node's [models.trust] names keys; stored either way.">
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
            <TagsInput value={tags} onChange={setTags} placeholder="vision, fraud" aria-label="Tags" />
          </div>

          {validation && (
            <div className="space-y-2">
              <ValidationResults
                result={validation}
                validLabel="This node would accept the registration."
              />
              {head && (
                <Callout variant="muted">
                  The bucket answered for the object
                  {head.size != null && <> · {head.size.toLocaleString()} bytes</>}
                  {head.etag && (
                    <>
                      {" "}
                      · ETag <code className="font-mono">{head.etag}</code>
                    </>
                  )}
                  . The digest is still only a claim until admission fetches the bytes and hashes
                  them.
                </Callout>
              )}
            </div>
          )}

          <FormError error={error} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button variant="outline" onClick={handleValidate} disabled={validateModel.isPending}>
              <ShieldCheck className="h-4 w-4" />
              {validateModel.isPending ? "Validating..." : "Validate"}
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || editLocked}>
              <Save className="h-4 w-4" />
              {isPending ? "Saving..." : isEdit ? "Save Draft" : "Register as Draft"}
            </Button>
          </div>

          {!isEdit && (
            <p className="text-xs text-muted-foreground">
              Registration answers <code className="font-mono">202</code>: the draft exists and is
              queued for admission on this node. It cannot be activated until the verdict is{" "}
              <code className="font-mono">passed</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

export function ModelFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data: existing, isLoading } = useModel(id ?? "")

  if (id && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full max-w-4xl" />
      </div>
    )
  }

  return <ModelForm key={existing?.model_id ?? "new"} existing={id ? existing : undefined} />
}
