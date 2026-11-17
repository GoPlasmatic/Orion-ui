import type {
  ConnectionRevision,
  ConnectorPackageSummary,
  ImplementationKind,
  ManifestMember,
  Page,
  ProviderBackendInfo,
} from "@/api/types"

/**
 * Reading connections (2.0). `GET admin/connections` lists every revision of
 * every connection, so the console groups them; a provider is named only by
 * digest, so the console resolves it against this node's composed backends
 * and the stored provider packages. Pure, so the pages, the map and the
 * dashboard read one answer.
 */

/** How many rows a "read every page" walk reads before it stops and says so. */
export const ALL_PAGES_CAP = 5000

/** Every page of a cursor list, up to `cap` rows; `truncated` when it stopped early. */
export async function fetchAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  cap = ALL_PAGES_CAP,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await fetchPage(cursor)
    rows.push(...page.data)
    cursor = page.next_cursor ?? undefined
    if (!cursor) return { rows, truncated: false }
    if (rows.length >= cap) return { rows, truncated: true }
  }
}

/** A provider, as a person would name it. */
export interface ProviderInfo {
  digest: string
  /** `org.orion.postgresql`, or `acme/acme.echo@1.0.0`. */
  label: string
  /** A built-in driver this node composes, or an uploaded package. */
  source: "built-in" | "package" | "unknown"
  kind: ImplementationKind | null
  /** For a package: whether it is admitted (and not revoked). */
  admitted?: boolean
  revoked?: boolean
  /** The connector family a hub icon and a filter read: `http`, `db`, `cache`, … */
  family: string
}

const FAMILY: Record<string, string> = {
  http: "http",
  "memory-cache": "cache",
  redis: "cache",
  postgresql: "db",
  mysql: "db",
  sqlite: "db",
  mongodb: "db",
  kafka: "kafka",
  smtp: "smtp",
  s3: "storage",
  elasticsearch: "es",
}

/** `org.orion.memory-cache` → `cache`. A driver this table does not know reads as its own last segment. */
export function driverFamily(driverId: string): string {
  const tail = driverId.split(".").pop() ?? driverId
  return FAMILY[tail] ?? tail
}

/** What `provider_digest` names, from what this node composes and what is uploaded. */
export function resolveProvider(
  digest: string,
  backends: readonly ProviderBackendInfo[] | undefined,
  packages: readonly ConnectorPackageSummary[] | undefined,
): ProviderInfo {
  const pkg = packages?.find((p) => p.digest === digest)
  if (pkg) {
    return {
      digest,
      label: `${pkg.publisher}/${pkg.provider_id}@${pkg.version}`,
      source: "package",
      kind: pkg.implementation,
      admitted: pkg.admitted,
      revoked: pkg.revoked,
      family: pkg.implementation === "rust" ? driverFamily(pkg.provider_id) : "provider",
    }
  }
  const backend = backends?.find((b) => b.package_digest === digest || b.driver_id === digest)
  if (backend) {
    return {
      digest,
      label: backend.kind === "rust" ? backend.driver_id : `${backend.kind} provider`,
      source: "built-in",
      kind: backend.kind,
      family: backend.kind === "rust" ? driverFamily(backend.driver_id) : "provider",
    }
  }
  return { digest, label: digest.replace(/^sha256:/, "").slice(0, 12), source: "unknown", kind: null, family: "provider" }
}

/** One connection and every stored revision of it, newest first, with the one the head deploys. */
export interface ConnectionGroup {
  connection_id: string
  revisions: ConnectionRevision[]
  latest: ConnectionRevision
  /** The revision the head's member names, when the head deploys this connection. */
  deployed?: ConnectionRevision
  /** The head's member names a revision this list does not hold (truncated, or deleted). */
  deployedMissing?: number
}

/** Group a flat list of revisions by connection, newest revision first; ids sorted. */
export function groupConnections(
  revisions: readonly ConnectionRevision[],
  members: readonly ManifestMember[] = [],
): ConnectionGroup[] {
  const by = new Map<string, ConnectionRevision[]>()
  for (const r of revisions) by.set(r.connection_id, [...(by.get(r.connection_id) ?? []), r])
  const deployedRev = new Map(
    members.filter((m) => m.entity.kind === "connection").map((m) => [m.entity.id, m.entity.revision]),
  )
  const out: ConnectionGroup[] = []
  for (const [connection_id, list] of by) {
    const sorted = [...list].sort((a, b) => b.revision - a.revision)
    const want = deployedRev.get(connection_id)
    const deployed = want != null ? sorted.find((r) => r.revision === want) : undefined
    out.push({
      connection_id,
      revisions: sorted,
      latest: sorted[0],
      deployed,
      deployedMissing: want != null && !deployed ? want : undefined,
    })
  }
  return out.sort((a, b) => a.connection_id.localeCompare(b.connection_id))
}

/** `billing-api@2` (an audit row's resource id for a connection revision) → its parts. */
export function parseConnectionRef(ref: string): { id: string; revision?: number } {
  const at = ref.lastIndexOf("@")
  if (at <= 0) return { id: ref }
  const revision = Number(ref.slice(at + 1))
  return Number.isInteger(revision) && revision > 0 ? { id: ref.slice(0, at), revision } : { id: ref }
}

/** The connections on a revision page: path → `{id}?revision=` when a revision is named. */
export function connectionRoute(id: string, revision?: number): string {
  return `/connections/${encodeURIComponent(id)}${revision ? `?revision=${revision}` : ""}`
}

/** Where a secret locator reads from, as a word: `env`, `vault`, … */
export function locatorScheme(locator: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(locator)
  return m ? m[1].toLowerCase() : "literal"
}
