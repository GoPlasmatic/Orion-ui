import type { PackageFiles } from "@/api/types"

/**
 * A provider package as the upload, lint and pack endpoints take it: relative
 * path → the file as UTF-8 text, or `base64:<…>` for bytes that are not
 * (a WebAssembly component). Built in the browser from a picked folder or
 * files.
 */

export interface PackageFileEntry {
  path: string
  size: number
  encoding: "text" | "base64"
}

/** Bytes as the wire wants them: text when they are valid UTF-8 with no NUL, `base64:` otherwise. */
export function encodeFile(bytes: Uint8Array): { value: string; encoding: "text" | "base64" } {
  if (!bytes.includes(0)) {
    try {
      return { value: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "text" }
    } catch {
      // Not UTF-8: fall through to base64.
    }
  }
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return { value: `base64:${btoa(binary)}`, encoding: "base64" }
}

/**
 * The package-relative path of a picked file. A folder pick names every file
 * under the folder itself (`acme-echo/connector.json`), so that first segment
 * is dropped when every file shares it.
 */
export function relativePaths(paths: string[]): string[] {
  const split = paths.map((p) => p.replace(/\\/g, "/").replace(/^\.?\//, "").split("/"))
  const first = split[0]?.[0]
  const shared = split.length > 0 && split.every((s) => s.length > 1 && s[0] === first)
  return split.map((s) => (shared ? s.slice(1) : s).join("/"))
}

/** Files the packer never wants: OS litter. */
const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/

/** Read picked files into the wire's `files` map. */
export async function readPackageFiles(
  picked: readonly File[],
): Promise<{ files: PackageFiles; entries: PackageFileEntry[] }> {
  const raw = picked.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
  const paths = relativePaths(raw)
  const files: PackageFiles = {}
  const entries: PackageFileEntry[] = []
  for (let i = 0; i < picked.length; i++) {
    const path = paths[i]
    if (!path || IGNORED.test(path)) continue
    const bytes = new Uint8Array(await picked[i].arrayBuffer())
    const { value, encoding } = encodeFile(bytes)
    files[path] = value
    entries.push({ path, size: bytes.length, encoding })
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { files, entries }
}

/** The entries of a `files` map that is already on the wire's terms (a scaffold, a pack). */
export function describeFiles(files: PackageFiles): PackageFileEntry[] {
  return Object.entries(files)
    .map(([path, value]) =>
      value.startsWith("base64:")
        ? { path, size: Math.floor(((value.length - 7) * 3) / 4), encoding: "base64" as const }
        : { path, size: new TextEncoder().encode(value).length, encoding: "text" as const },
    )
    .sort((a, b) => a.path.localeCompare(b.path))
}
