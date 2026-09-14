import { describe, it, expect } from "vitest"
import { lintManifest, checkModelName, formatTensorType, blankManifest, MODEL_ABI } from "./model-manifest"

const valid = {
  abi: MODEL_ABI,
  name: "example.c4-tiny",
  version: "0.1.0",
  format: "onnx",
  inputs: [
    {
      name: "board",
      dtype: "f32",
      shape: [1, 2, 6, 7],
      adapter: { tensor: [{ var: "data.board" }, "f32"] },
    },
  ],
  outputs: [{ name: "policy", dtype: "f32", shape: [1, 7] }],
  result: { policy: { to_list: [{ var: "policy" }] } },
}

const paths = (m: unknown) => lintManifest(m).map((i) => i.path)

describe("lintManifest", () => {
  it("accepts the documented c4-tiny manifest", () => {
    expect(lintManifest(valid)).toEqual([])
  })

  it("accepts a manifest that declares neither adapter nor result", () => {
    const inputs = [{ name: "board", dtype: "f32", shape: [1, 2, 6, 7] }]
    expect(lintManifest({ ...valid, inputs, result: undefined })).toEqual([])
  })

  it("requires the abi this server speaks", () => {
    expect(paths({ ...valid, abi: "orion:model@2.0.0" })).toContain("abi")
    expect(paths({ ...valid, abi: undefined })).toContain("abi")
  })

  it("requires at least one input", () => {
    expect(paths({ ...valid, inputs: [] })).toContain("inputs")
    expect(paths({ ...valid, inputs: undefined })).toContain("inputs")
  })

  it("reports a duplicate tensor name at its own coordinate", () => {
    const inputs = [
      { name: "a", dtype: "f32", shape: [1] },
      { name: "a", dtype: "f32", shape: [1] },
    ]
    expect(paths({ ...valid, inputs })).toContain("inputs[1].name")
  })

  it("scopes uniqueness per list — an input and an output may share a name", () => {
    const inputs = [{ name: "x", dtype: "f32", shape: [1] }]
    const outputs = [{ name: "x", dtype: "f32", shape: [1] }]
    expect(lintManifest({ ...valid, inputs, outputs, result: undefined })).toEqual([])
  })

  it("refuses a zero dimension at the dimension's own index", () => {
    const inputs = [{ name: "a", dtype: "f32", shape: [1, 0, 3] }]
    expect(paths({ ...valid, inputs })).toContain("inputs[0].shape[1]")
  })

  it("refuses an empty shape", () => {
    const inputs = [{ name: "a", dtype: "f32", shape: [] }]
    expect(paths({ ...valid, inputs })).toContain("inputs[0].shape")
  })

  describe("dtype", () => {
    it("refuses an unknown one", () => {
      const inputs = [{ name: "a", dtype: "float32", shape: [1] }]
      expect(paths({ ...valid, inputs })).toContain("inputs[0].dtype")
    })

    it("refuses half precision with the reason, not as unknown", () => {
      const inputs = [{ name: "a", dtype: "f16", shape: [1] }]
      const issue = lintManifest({ ...valid, inputs }).find((i) => i.path === "inputs[0].dtype")
      expect(issue?.message).toContain("half-precision")
    })

    it("refuses an uppercase spelling, naming the lowercase one", () => {
      const inputs = [{ name: "a", dtype: "F32", shape: [1] }]
      const issue = lintManifest({ ...valid, inputs }).find((i) => i.path === "inputs[0].dtype")
      expect(issue?.message).toContain("must be spelled 'f32'")
    })
  })

  describe("the expression screen", () => {
    it("refuses a secret read in an adapter", () => {
      const inputs = [
        { name: "a", dtype: "f32", shape: [1], adapter: { tensor: [{ secret: "key" }, "f32"] } },
      ]
      const issue = lintManifest({ ...valid, inputs }).find((i) =>
        i.path.startsWith("inputs[0].adapter"),
      )
      expect(issue?.message).toContain("secret store")
    })

    it("refuses the clock and randomness however deeply nested", () => {
      const inputs = [
        { name: "a", dtype: "f32", shape: [1], adapter: { tensor: [[{ now: [] }], "f32"] } },
      ]
      expect(lintManifest({ ...valid, inputs }).some((i) => i.message.includes("clock"))).toBe(true)
      expect(
        lintManifest({ ...valid, result: { x: { random: [] } } }).some((i) =>
          i.message.includes("randomness"),
        ),
      ).toBe(true)
    })

    it("leaves a multi-key object alone — only a single-key object is a call", () => {
      const result = { secret: "a", other: "b" }
      expect(lintManifest({ ...valid, result })).toEqual([])
    })
  })

  describe("format and artifact", () => {
    it("defaults to onnx when absent", () => {
      expect(lintManifest({ ...valid, format: undefined })).toEqual([])
    })

    it("refuses a format no runtime serves", () => {
      expect(paths({ ...valid, format: "tflite" })).toContain("format")
    })

    it("refuses an artifact path that is absolute or climbs out", () => {
      expect(paths({ ...valid, artifact: "/tmp/m.onnx" })).toContain("artifact")
      expect(paths({ ...valid, artifact: "../m.onnx" })).toContain("artifact")
      expect(lintManifest({ ...valid, artifact: "m.onnx" })).toEqual([])
    })

    it("requires both members of a reference when one is given", () => {
      expect(paths({ ...valid, reference: { connector: "models", key: "" } })).toContain(
        "reference.key",
      )
      expect(lintManifest({ ...valid, reference: { connector: "m", key: "k.onnx" } })).toEqual([])
    })
  })
})

describe("checkModelName", () => {
  it("accepts dotted lowercase labels", () => {
    expect(checkModelName("example.c4-tiny")).toBeNull()
  })

  it.each(["Example.x", "example.C4", "1st.model", "example..x", ""])("refuses %o", (name) => {
    expect(checkModelName(name)).not.toBeNull()
  })

  it("reserves the orion namespace", () => {
    expect(checkModelName("orion")).toContain("reserved")
    expect(checkModelName("orion.classifier")).toContain("reserved")
    expect(checkModelName("orionish.classifier")).toBeNull()
  })
})

describe("formatTensorType", () => {
  it("renders dtype and shape the way a signature reads", () => {
    expect(formatTensorType("f32", [1, 2, 6, 7])).toBe("f32[1, 2, 6, 7]")
  })

  it("survives a declaration that did not lint", () => {
    expect(formatTensorType(undefined, undefined)).toBe("?[]")
  })
})

describe("blankManifest", () => {
  it("is a shape the linter already accepts but for the empty name", () => {
    expect(paths(blankManifest())).toEqual(["name"])
  })
})
