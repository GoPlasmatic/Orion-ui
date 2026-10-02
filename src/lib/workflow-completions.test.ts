import { describe, expect, it } from "vitest"
import { parser } from "@lezer/json"
import type { FunctionSchema } from "@/api/types"
import { stepCompletions } from "@/lib/workflow-completions"

/** Complete at the `|` in `src`. */
function complete(src: string, functions: FunctionSchema[] = [], explicit = false) {
  const pos = src.indexOf("|")
  const doc = src.slice(0, pos) + src.slice(pos + 1)
  const source = stepCompletions(() => functions)
  return source({ doc, tree: parser.parse(doc), pos, explicit })
}

const labels = (r: ReturnType<typeof complete>) => (r?.options ?? []).map((o) => o.label)

describe("step completions", () => {
  it("offers map's mapping keys and the mode spellings (1.12)", () => {
    const keys = complete('[{"function": {"name": "map", "input": {"mappings": [{"|"}]}}}]')
    expect(labels(keys)).toEqual(expect.arrayContaining(["path", "logic", "mode", "on_null"]))
    const modes = complete('[{"function": {"name": "map", "input": {"mappings": [{"mode": "|"}]}}}]')
    expect(labels(modes)).toEqual(expect.arrayContaining(["append", "extend"]))
  })

  it("tops the catalogue up with fields an older server does not describe", () => {
    const catalogue = [
      {
        name: "cache_invalidate",
        source: "orion",
        category: "cache",
        description: "",
        input_fields: [{ name: "output", kind: "string", required: false }],
      },
    ] as unknown as FunctionSchema[]
    const r = complete('[{"function": {"name": "cache_invalidate", "input": {"|"}}}]', catalogue)
    // The catalogue's own field once, the hint's missing one added.
    expect(labels(r)).toEqual(["output", "namespaces"])
    expect(labels(complete('[{"function": {"name": "cache_incr", "input": {"|"}}}]'))).toEqual(
      expect.arrayContaining(["connector", "key", "by", "ttl_secs"])
    )
    expect(labels(complete('[{"function": {"name": "model_infer", "input": {"|"}}}]'))).toContain("select")
    expect(labels(complete('[{"function": {"name": "storage_presign", "input": {"|"}}}]'))).toContain(
      "content_length"
    )
  })

  it("knows a loop's keys and treats its setup as steps", () => {
    expect(labels(complete('{"loop": {"|"}}'))).toEqual(
      expect.arrayContaining(["setup", "over", "as", "counter", "max", "scratch"])
    )
    expect(labels(complete('{"loop": {"setup": [{"|"}]}}'))).toEqual(
      expect.arrayContaining(["id", "function", "tasks"])
    )
  })
})
