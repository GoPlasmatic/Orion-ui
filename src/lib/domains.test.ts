import { describe, expect, it } from "vitest"
import { buildDomains, middleTruncate, sharedPrefix, shortName } from "@/lib/domains"

const QA = ["soma-admin-check", "soma-admin-runner-keys-list", "soma-clock-pair", "soma-gate-start", "soma-pub-posts-get"]

describe("domains", () => {
  it("finds the product prefix QA shares", () => {
    expect(sharedPrefix(QA)).toBe("soma-")
  })

  it("never lets the prefix swallow the domain segment", () => {
    expect(sharedPrefix(["orders-create", "orders-list"])).toBe("")
    expect(sharedPrefix(["a-b-c", "a-b-d"])).toBe("a-")
    expect(sharedPrefix(["a-b-c-x", "a-b-d-y"])).toBe("a-b-")
  })

  it("groups by the segment after the prefix, biggest domain first", () => {
    const idx = buildDomains(QA.map((name) => ({ name })))
    expect([...idx.members.keys()]).toEqual(["admin", "clock", "gate", "pub"])
    expect(idx.domainOf.get("soma-clock-pair")).toBe("clock")
  })

  it("groups by a chosen tag, with the rest in other", () => {
    const idx = buildDomains(
      [
        { name: "a", tags: ["soma", "admin"] },
        { name: "b", tags: ["pub"] },
        { name: "c", tags: [] },
      ],
      { by: "tag", tags: ["admin", "pub"] },
    )
    expect(idx.domainOf.get("a")).toBe("admin")
    expect(idx.domainOf.get("c")).toBe("other")
  })

  it("labels a channel without the prefix and its domain", () => {
    const idx = buildDomains(QA.map((name) => ({ name })))
    expect(shortName("soma-admin-runner-keys-list", idx)).toBe("runner-keys-list")
    expect(shortName("soma-clock-pair", idx)).toBe("pair")
  })

  it("cuts in the middle so both ends survive", () => {
    expect(middleTruncate("soma-admin-runner-keys-list", 15)).toBe("soma-ad…ys-list")
    expect(middleTruncate("short", 15)).toBe("short")
  })
})
