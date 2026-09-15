import type { ModelAdmission, ModelDim, ModelManifest } from "@/api/types"
import { isObject, type StepIssue } from "@/lib/workflow-steps"

/**
 * Reading and shape-checking an `orion:model@1.0.0` manifest.
 *
 * Mirrors the server's `model/manifest.rs` so an author fixes a manifest in
 * the editor rather than in a round trip — the same relationship `lintSteps`
 * has to `engine/steps.rs`. It is a *shape* check, not the authority: the
 * server also compiles every expression on the serving engine's own operator
 * vocabulary, which a browser cannot do. Validate is the authority; this is
 * the fast half.
 *
 * Issues carry the coordinate the author typed (`inputs[0].dtype`), so
 * `lib/json-path.ts` maps them to a range in the document exactly as it does
 * for a workflow's steps.
 */

/** The one manifest version this server speaks. */
export const MODEL_ABI = "orion:model@1.0.0"

/** The artifact formats a runtime this build knows serves. */
export const KNOWN_FORMATS = ["onnx"] as const

/**
 * The datavalue dtype wire names an adapter can actually decode. `f16` and
 * `bf16` are real dtypes the format declares but 1.x refuses — a manifest
 * should declare the model's f32 boundary and let the graph cast.
 */
export const MODEL_DTYPES = [
  "bool",
  "i8",
  "u8",
  "i16",
  "u16",
  "i32",
  "u32",
  "i64",
  "u64",
  "f32",
  "f64",
] as const

const HALF_DTYPES = ["f16", "bf16"]

/**
 * What an adapter may not read, and why. The screen is structural — any
 * single-key object under one of these keys, anywhere in the expression —
 * because to a bare engine an unregistered key is just data, so spotting the
 * *shape* is the only check that holds.
 */
const FORBIDDEN_OPERATORS: Record<string, string> = {
  secret:
    "an adapter may not read the secret store: a manifest is authored by the model's owner, and the secrets are the deployment's",
  now: "an adapter may not read the clock: a replay of a traced inference must reproduce the same tensors",
  random:
    "an adapter may not draw randomness: a replay of a traced inference must reproduce the same tensors",
}

/** A label of a model id: lowercase, starts with a letter, then `[a-z0-9-]`. */
function isLabel(label: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(label)
}

/** The model id rule: lowercase labels joined by `.`, with `orion.*` reserved. */
export function checkModelName(name: string): string | null {
  if (name === "") return "model name must not be empty"
  for (const label of name.split(".")) {
    if (!isLabel(label)) {
      return `label '${label}' must be lowercase, start with a letter and contain only [a-z0-9-]`
    }
  }
  if (name === "orion" || name.startsWith("orion.")) {
    return "the 'orion' namespace is reserved"
  }
  return null
}

function checkDtype(dtype: unknown): string | null {
  if (typeof dtype !== "string" || dtype === "") return "dtype is required"
  const lower = dtype.toLowerCase()
  if (HALF_DTYPES.includes(lower)) {
    return `dtype '${dtype}' is not supported in 1.x: an adapter cannot decode half-precision tensors, so declare the model's f32 boundary and let the graph cast`
  }
  if (!(MODEL_DTYPES as readonly string[]).includes(lower)) {
    return `unknown dtype '${dtype}'; one of ${MODEL_DTYPES.join(", ")}`
  }
  // `from_name` is case-insensitive, but the wire name is the lowercase one.
  if (lower !== dtype) {
    return `dtype '${dtype}' must be spelled '${lower}': the wire name is lowercase`
  }
  return null
}

/**
 * A named dimension: a letter or `_`, then letters, digits and `_`. Mirrors
 * the server's `check_dim_name`.
 */
function checkDimName(name: string): string | null {
  if (name === "") return "a named dimension must not be empty"
  if (!/^[A-Za-z_]/.test(name)) {
    return `a named dimension must start with a letter or '_': '${name}'`
  }
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    return `a named dimension may hold only letters, digits and '_': '${name}'`
  }
  return null
}

/**
 * One shape's dimensions, collecting the names it declares.
 *
 * Since 1.8.1 a dimension is a count **or** a name standing for whatever the
 * call brings. A name binds on its first occurrence in a call and every later
 * occurrence — in another input, or in an output — must equal that binding,
 * which is what makes `["N", 3]` on an output mean the N the input had. Only
 * the server can check that, because it happens per message; what is checked
 * here is that a name is spellable.
 */
function checkShape(path: string, shape: unknown, names: Set<string>, out: StepIssue[]): void {
  if (!Array.isArray(shape) || shape.length === 0) {
    out.push({ path: `${path}.shape`, message: "must list at least one dimension" })
    return
  }
  shape.forEach((dim, i) => {
    if (typeof dim === "string") {
      const reason = checkDimName(dim)
      if (reason) out.push({ path: `${path}.shape[${i}]`, message: reason })
      else names.add(dim)
    } else if (typeof dim !== "number" || !Number.isInteger(dim)) {
      out.push({
        path: `${path}.shape[${i}]`,
        message: "must be a whole number, or a name standing for a dimension a call decides",
      })
    } else if (dim <= 0) {
      out.push({
        path: `${path}.shape[${i}]`,
        message:
          "a fixed dimension must be positive: a zero dimension is a tensor with nothing in it. Name the dimension instead to let a call decide it",
      })
    }
  })
}

/** Refuse a forbidden operator wherever it sits in an expression. */
function screen(path: string, logic: unknown, out: StepIssue[]): void {
  if (Array.isArray(logic)) {
    logic.forEach((item, i) => screen(`${path}[${i}]`, item, out))
    return
  }
  if (!isObject(logic)) return
  const keys = Object.keys(logic)
  if (keys.length === 1) {
    const reason = FORBIDDEN_OPERATORS[keys[0]]
    if (reason) out.push({ path, message: `uses {"${keys[0]}": …}: ${reason}` })
  }
  for (const key of keys) screen(`${path}.${key}`, logic[key], out)
}

/** One tensor declaration's shared rules: a unique non-empty name, a supported dtype, a positive shape. */
function checkTensorDecl(
  path: string,
  decl: unknown,
  seen: Set<string>,
  names: Set<string>,
  out: StepIssue[],
): void {
  if (!isObject(decl)) {
    out.push({ path, message: "must be an object" })
    return
  }
  const name = decl.name
  if (typeof name !== "string" || name === "") {
    out.push({ path: `${path}.name`, message: "is required and must be a non-empty string" })
  } else if (seen.has(name)) {
    out.push({ path: `${path}.name`, message: `'${name}' is declared twice` })
  } else {
    seen.add(name)
  }
  const dtype = checkDtype(decl.dtype)
  if (dtype) out.push({ path: `${path}.dtype`, message: dtype })
  checkShape(path, decl.shape, names, out)
}

/**
 * `probe_dims`: what each named dimension is worth to the admission probe,
 * which needs concrete tensors to run its five zero-filled inferences.
 *
 * A name the manifest declares and this leaves out is probed at 1 — the
 * smallest tensor there is — so an absent entry is never a finding. What is
 * refused is an entry that means nothing: a name no shape declares, or a size
 * the probe cannot build a tensor of.
 */
function checkProbeDims(probeDims: unknown, names: Set<string>, out: StepIssue[]): void {
  if (!isObject(probeDims)) {
    out.push({ path: "probe_dims", message: "must be an object of dimension name to size" })
    return
  }
  const declared = [...names].sort()
  for (const [name, size] of Object.entries(probeDims)) {
    const path = `probe_dims.${name}`
    if (!names.has(name)) {
      out.push({
        path,
        message:
          declared.length === 0
            ? "no shape in this manifest declares a named dimension"
            : `'${name}' is not a dimension this manifest names; it names ${declared.map((d) => `'${d}'`).join(", ")}`,
      })
    } else if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
      out.push({
        path,
        message: "a probe dimension must be a positive whole number: the probe builds a real tensor of it",
      })
    }
  }
}

/**
 * Every rule the manifest's own shape cannot express. Empty for a manifest
 * `POST admin/models/validate` would accept on the shape it checks first.
 */
export function lintManifest(manifest: unknown): StepIssue[] {
  const out: StepIssue[] = []
  if (!isObject(manifest)) {
    out.push({ path: "manifest", message: "must be a JSON object" })
    return out
  }

  if (manifest.abi !== MODEL_ABI) {
    out.push({
      path: "abi",
      message:
        typeof manifest.abi === "string"
          ? `unsupported abi '${manifest.abi}': this server speaks '${MODEL_ABI}'`
          : `is required and must be '${MODEL_ABI}'`,
    })
  }

  if (typeof manifest.name !== "string") {
    out.push({ path: "name", message: "is required and must be a string" })
  } else {
    const reason = checkModelName(manifest.name)
    if (reason) out.push({ path: "name", message: `model name '${manifest.name}': ${reason}` })
  }

  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    out.push({ path: "version", message: "must not be empty" })
  }

  // Absent means `onnx`, so only a stated format is checked.
  if (manifest.format !== undefined) {
    if (
      typeof manifest.format !== "string" ||
      !(KNOWN_FORMATS as readonly string[]).includes(manifest.format)
    ) {
      out.push({
        path: "format",
        message: `unsupported format '${String(manifest.format)}': this server loads ${KNOWN_FORMATS.map((f) => `'${f}'`).join(", ")}`,
      })
    }
  }

  // Read by the offline tooling only, but a path that climbs out of the
  // manifest's directory is refused rather than resolved.
  if (manifest.artifact !== undefined) {
    const artifact = manifest.artifact
    if (typeof artifact !== "string" || artifact === "") {
      out.push({ path: "artifact", message: "must be a non-empty relative path" })
    } else if (artifact.startsWith("/")) {
      out.push({
        path: "artifact",
        message: `artifact path '${artifact}' must be relative to the manifest`,
      })
    } else if (artifact.split("/").includes("..")) {
      out.push({
        path: "artifact",
        message: `artifact path '${artifact}' must not climb out of the manifest's directory`,
      })
    }
  }

  if (manifest.reference !== undefined) {
    const reference = manifest.reference
    if (!isObject(reference)) {
      out.push({ path: "reference", message: "must be an object" })
    } else {
      for (const field of ["connector", "key"] as const) {
        const value = reference[field]
        if (typeof value !== "string" || value.trim() === "") {
          out.push({ path: `reference.${field}`, message: "must not be empty" })
        }
      }
    }
  }

  // Every named dimension the shapes declare, across inputs *and* outputs: a
  // name means the same axis wherever it appears, which is what lets an
  // output's `["N", 1]` mean the N an input bound.
  const names = new Set<string>()

  const inputs = manifest.inputs
  if (!Array.isArray(inputs) || inputs.length === 0) {
    out.push({ path: "inputs", message: "a model must declare at least one input" })
  } else {
    const seen = new Set<string>()
    inputs.forEach((input, i) => {
      const path = `inputs[${i}]`
      checkTensorDecl(path, input, seen, names, out)
      if (isObject(input) && input.adapter !== undefined) {
        screen(`${path}.adapter`, input.adapter, out)
      }
    })
  }

  const outputs = manifest.outputs
  if (outputs !== undefined) {
    if (!Array.isArray(outputs)) {
      out.push({ path: "outputs", message: "must be a JSON array" })
    } else {
      const seen = new Set<string>()
      outputs.forEach((output, i) => checkTensorDecl(`outputs[${i}]`, output, seen, names, out))
    }
  }

  if (manifest.probe_dims !== undefined) checkProbeDims(manifest.probe_dims, names, out)

  if (manifest.result !== undefined) screen("result", manifest.result, out)

  return out
}

/**
 * `f32[1, 2, 6, 7]` — how a tensor declaration reads in a signature table. A
 * named dimension prints as its name (`f32[N, 3]`), which is how it is
 * written and the only thing that could be shown: the size is whatever the
 * call brings.
 */
export function formatTensorType(
  dtype: string | undefined,
  shape: ModelDim[] | undefined
): string {
  const dims = Array.isArray(shape) ? shape.join(", ") : ""
  return `${dtype ?? "?"}[${dims}]`
}

/**
 * A starting manifest for the create form. Deliberately a *working shape*
 * rather than an empty skeleton: the adapter and result defaults are what a
 * caller that already speaks tensors wants, and seeing them spelled out is
 * how an author learns they can be left out.
 */
export function blankManifest(): ModelManifest {
  return {
    abi: MODEL_ABI,
    name: "",
    version: "0.1.0",
    format: "onnx",
    inputs: [{ name: "input", dtype: "f32", shape: [1, 1] }],
    outputs: [{ name: "output", dtype: "f32", shape: [1, 1] }],
  }
}


/**
 * The stage a failed admission stopped at, as a person reads it.
 *
 * `stage` is set alongside a verdict and absent on a pending one, and it is
 * the first thing an operator looks for when a model will not activate — so
 * the fallback is spelled once rather than in each of the four places that
 * report a failure.
 */
export function admissionStage(admission: ModelAdmission): string {
  return admission.stage ?? "an unnamed stage"
}

/** `Admission failed at fetch: the bucket refused the GET` — the whole verdict in one line. */
export function admissionFailure(admission: ModelAdmission): string {
  const reason = admission.reason ? `: ${admission.reason}` : ""
  return `Admission failed at ${admissionStage(admission)}${reason}`
}
