// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { ConnectionRevision, ConnectorPackageSummary, ManifestMember, ProviderBackendInfo } from "@/api/types"
import {
  driverFamily,
  fetchAllPages,
  groupConnections,
  locatorScheme,
  parseConnectionRef,
  resolveProvider,
} from "@/lib/connections"

const rev = (connection_id: string, revision: number, provider_digest = "sha256:http"): ConnectionRevision => ({
  connection_id,
  revision,
  provider_digest,
  public_config: {},
  secret_locators: {},
  bindings: {},
  configuration_digest: `sha256:${connection_id}-${revision}`,
})

describe("groupConnections", () => {
  const members: ManifestMember[] = [
    { entity: { kind: "connection", id: "db", revision: 2 }, definition_digest: "sha256:db-2" },
    { entity: { kind: "connection", id: "gone", revision: 4 }, definition_digest: "sha256:gone-4" },
    { entity: { kind: "workflow", id: "db", revision: 9 }, definition_digest: "sha256:w" },
  ]
  const groups = groupConnections([rev("db", 1), rev("cache", 1), rev("db", 3), rev("db", 2)], members)

  it("groups every revision by connection, newest first, ids sorted", () => {
    expect(groups.map((g) => g.connection_id)).toEqual(["cache", "db"])
    expect(groups[1].revisions.map((r) => r.revision)).toEqual([3, 2, 1])
    expect(groups[1].latest.revision).toBe(3)
  })

  it("marks the revision the head deploys — by connection member only", () => {
    expect(groups[1].deployed?.revision).toBe(2)
    expect(groups[0].deployed).toBeUndefined()
  })

  it("says when the head names a revision the list does not hold", () => {
    const [only] = groupConnections([rev("gone", 1)], members)
    expect(only.deployed).toBeUndefined()
    expect(only.deployedMissing).toBe(4)
  })
})

describe("resolveProvider", () => {
  const backends: ProviderBackendInfo[] = [
    { kind: "rust", driver_id: "org.orion.memory-cache", package_digest: "sha256:mem" },
    { kind: "workflow", driver_id: "sha256:pkg" },
  ]
  const packages = [
    { digest: "sha256:pkg", publisher: "acme", provider_id: "acme.echo", version: "1.0.0", implementation: "workflow", admitted: true, revoked: false },
  ] as ConnectorPackageSummary[]

  it("names a built-in driver by its id and family", () => {
    expect(resolveProvider("sha256:mem", backends, packages)).toMatchObject({
      label: "org.orion.memory-cache",
      source: "built-in",
      family: "cache",
    })
  })

  it("prefers the stored package's own name over its backend entry", () => {
    expect(resolveProvider("sha256:pkg", backends, packages)).toMatchObject({
      label: "acme/acme.echo@1.0.0",
      source: "package",
      admitted: true,
    })
  })

  it("keeps an unknown digest visible, shortened", () => {
    expect(resolveProvider("sha256:abcdef0123456789", backends, packages)).toMatchObject({
      label: "abcdef012345",
      source: "unknown",
    })
  })

  it("reads a driver it has no table entry for as its last segment", () => {
    expect(driverFamily("org.orion.postgresql")).toBe("db")
    expect(driverFamily("com.example.ldap")).toBe("ldap")
  })
})

describe("fetchAllPages", () => {
  it("follows the cursor to the end, and stops at the cap saying so", async () => {
    const pages = [
      { data: [1, 2], limit: 2, next_cursor: "a" },
      { data: [3, 4], limit: 2, next_cursor: "b" },
      { data: [5], limit: 2 },
    ]
    const seen: (string | undefined)[] = []
    const all = await fetchAllPages(async (c) => {
      seen.push(c)
      return pages[seen.length - 1]
    })
    expect(all).toEqual({ rows: [1, 2, 3, 4, 5], truncated: false })
    expect(seen).toEqual([undefined, "a", "b"])
    let n = 0
    const capped = await fetchAllPages(async () => pages[n++], 3)
    expect(capped).toEqual({ rows: [1, 2, 3, 4], truncated: true })
  })
})

describe("references", () => {
  it("reads an audit row's connection id and revision", () => {
    expect(parseConnectionRef("billing-api@2")).toEqual({ id: "billing-api", revision: 2 })
    expect(parseConnectionRef("billing-api")).toEqual({ id: "billing-api" })
    expect(parseConnectionRef("odd@name")).toEqual({ id: "odd@name" })
  })

  it("names where a secret is read from", () => {
    expect(locatorScheme("env://TOKEN")).toBe("env")
    expect(locatorScheme("vault://kv/db#password")).toBe("vault")
    expect(locatorScheme("plain")).toBe("literal")
  })
})
