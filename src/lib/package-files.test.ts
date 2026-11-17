import { describe, expect, it } from "vitest"
import { describeFiles, encodeFile, readPackageFiles, relativePaths } from "@/lib/package-files"

describe("package files", () => {
  it("keeps UTF-8 as text and sends anything else as base64", () => {
    expect(encodeFile(new TextEncoder().encode('{"id":"é"}'))).toEqual({ value: '{"id":"é"}', encoding: "text" })
    // A WebAssembly header: NUL bytes, so binary.
    expect(encodeFile(new Uint8Array([0, 0x61, 0x73, 0x6d]))).toEqual({ value: "base64:AGFzbQ==", encoding: "base64" })
    expect(encodeFile(new Uint8Array([0xff, 0xfe]))).toMatchObject({ encoding: "base64" })
  })

  it("drops the picked folder's own name from every path", () => {
    expect(relativePaths(["acme/connector.json", "acme/schemas/a.json"])).toEqual(["connector.json", "schemas/a.json"])
    expect(relativePaths(["connector.json", "distribution.json"])).toEqual(["connector.json", "distribution.json"])
  })

  it("reads picked files into the wire's map, leaving OS litter out", async () => {
    const file = (name: string, body: string | Uint8Array<ArrayBuffer>) => {
      const f = new File([body], name.split("/").pop()!)
      Object.defineProperty(f, "webkitRelativePath", { value: name })
      return f
    }
    const { files, entries } = await readPackageFiles([
      file("pkg/connector.json", "{}"),
      file("pkg/.DS_Store", "x"),
      file("pkg/component.wasm", new Uint8Array([0, 1, 2])),
    ])
    expect(Object.keys(files).sort()).toEqual(["component.wasm", "connector.json"])
    expect(files["component.wasm"]).toBe("base64:AAEC")
    expect(entries).toEqual([
      { path: "component.wasm", size: 3, encoding: "base64" },
      { path: "connector.json", size: 2, encoding: "text" },
    ])
    expect(describeFiles(files)).toEqual(entries)
  })
})
