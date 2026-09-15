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

  /**
   * 1.8.1 (#318): a dimension is a count *or* a name standing for whatever the
   * call brings. Before this the lint required a whole number, so it reported
   * the server's headline feature as two errors in the author's editor.
   */
  describe("a variable axis", () => {
    const dynamic = {
      ...valid,
      inputs: [{ name: "board", dtype: "f32", shape: ["N", 3] }],
      outputs: [{ name: "policy", dtype: "f32", shape: ["N", 1] }],
      result: undefined,
    }

    it("accepts a named dimension in an input and an output", () => {
      expect(lintManifest(dynamic)).toEqual([])
    })

    it("accepts a shape mixing names and counts", () => {
      const inputs = [{ name: "a", dtype: "f32", shape: [1, "H", "W", 3] }]
      expect(lintManifest({ ...dynamic, inputs, outputs: undefined })).toEqual([])
    })

    it("refuses a name that does not start with a letter or underscore", () => {
      const inputs = [{ name: "a", dtype: "f32", shape: ["2N"] }]
      expect(paths({ ...dynamic, inputs, outputs: undefined })).toEqual(["inputs[0].shape[0]"])
    })

    it("refuses a name carrying anything but letters, digits and underscore", () => {
      const inputs = [{ name: "a", dtype: "f32", shape: ["batch-size"] }]
      expect(paths({ ...dynamic, inputs, outputs: undefined })).toEqual(["inputs[0].shape[0]"])
    })

    it("still refuses a zero count, and points at naming the axis instead", () => {
      const inputs = [{ name: "a", dtype: "f32", shape: [1, 0] }]
      const found = lintManifest({ ...dynamic, inputs, outputs: undefined })
      expect(found.map((i) => i.path)).toEqual(["inputs[0].shape[1]"])
      expect(found[0].message).toContain("Name the dimension instead")
    })

    it("still refuses a dimension that is neither a count nor a name", () => {
      const inputs = [{ name: "a", dtype: "f32", shape: [1.5] }]
      expect(paths({ ...dynamic, inputs, outputs: undefined })).toEqual(["inputs[0].shape[0]"])
    })
  })

  /**
   * `probe_dims` says what to run each named axis at for the admission probe,
   * which needs concrete tensors. A declared name it leaves out is probed at
   * 1, so an absent entry is never a finding — what is refused is an entry
   * that means nothing.
   */
  describe("probe_dims", () => {
    const dynamic = {
      ...valid,
      inputs: [{ name: "board", dtype: "f32", shape: ["N", 3] }],
      outputs: undefined,
      result: undefined,
    }

    it("accepts a size for a name a shape declares", () => {
      expect(lintManifest({ ...dynamic, probe_dims: { N: 8 } })).toEqual([])
    })

    it("accepts a manifest that names an axis and leaves probe_dims out", () => {
      expect(lintManifest(dynamic)).toEqual([])
    })

    it("refuses a name no shape declares, listing the ones that are", () => {
      const found = lintManifest({ ...dynamic, probe_dims: { M: 8 } })
      expect(found.map((i) => i.path)).toEqual(["probe_dims.M"])
      expect(found[0].message).toContain("'N'")
    })

    it("says so plainly when the manifest names no dimension at all", () => {
      const found = lintManifest({ ...valid, probe_dims: { N: 8 } })
      expect(found.map((i) => i.path)).toEqual(["probe_dims.N"])
      expect(found[0].message).toContain("no shape in this manifest declares")
    })

    it("refuses a non-positive size — the probe builds a real tensor of it", () => {
      expect(paths({ ...dynamic, probe_dims: { N: 0 } })).toEqual(["probe_dims.N"])
    })

    it("reads a name an output alone declares", () => {
      const outputs = [{ name: "policy", dtype: "f32", shape: ["T", 1] }]
      expect(lintManifest({ ...dynamic, outputs, probe_dims: { T: 4 } })).toEqual([])
    })
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

  it("prints a named dimension as its name — the size is whatever the call brings", () => {
    expect(formatTensorType("f32", ["N", 3])).toBe("f32[N, 3]")
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
