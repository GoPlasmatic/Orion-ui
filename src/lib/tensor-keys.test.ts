import { describe, it, expect } from "vitest"
import { tensorKeyAdvisories, TENSOR_OPERATORS, COLLIDING_OPERATORS } from "./tensor-keys"
import type { FunctionFieldSchema, FunctionSchema } from "@/api/types"

/**
 * The catalogue as `GET admin/functions` serves it, trimmed to what this lint
 * reads: `template_at` on the fields whose value is an expression. `map` is an
 * engine built-in and carries no `input_fields` at all — the lint has to know
 * its shape by hand, which is the case worth pinning.
 */
/** A catalogue field with the members every entry carries, so the fixture is the real shape. */
const field = (
  name: string,
  kind: FunctionFieldSchema["kind"],
  extra: Partial<FunctionFieldSchema> = {},
): FunctionFieldSchema => ({
  name,
  description: "",
  kind,
  required: false,
  resolvable: false,
  secret_at: [],
  alias: null,
  ...extra,
})

const catalogue: FunctionSchema[] = [
  {
    name: "map",
    description: "",
    category: "data",
    source: "engine",
    retry_safety: { kind: "pure" },
    // No input_fields, exactly as the server omits them for an engine built-in.
  },
  {
    name: "model_infer",
    description: "",
    category: "compute",
    source: "orion",
    retry_safety: { kind: "pure" },
    input_fields: [
      field("model", "string", { required: true, template_at: [""] }),
      field("input", "any", { required: true, template_at: [""] }),
      field("output", "string"),
    ],
  },
  {
    name: "http_call",
    description: "",
    category: "connector",
    source: "orion",
    retry_safety: { kind: "depends_on", input: "method" },
    input_fields: [
      field("connector", "string", { required: true }),
      // A member-wise template position: each value is an expression.
      field("headers", "object", { template_at: ["*"] }),
    ],
  },
]

/** One `map` task whose single mapping emits `logic`. */
const mapping = (logic: unknown) => [
  {
    id: "m",
    name: "Map",
    function: { name: "map", input: { mappings: [{ path: "data.x", logic }] } },
  },
]

const paths = (steps: unknown) => tensorKeyAdvisories(steps, catalogue).map((i) => i.path)

describe("tensorKeyAdvisories", () => {
  it("reports the upgrade guide's own example, at the key's coordinate", () => {
    const issues = tensorKeyAdvisories(mapping({ shape: [6, 7] }), catalogue)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe("tasks[0].function.input.mappings[0].logic.shape")
    expect(issues[0].message).toContain("$shape")
  })

  it("stays quiet once the key is escaped", () => {
    expect(paths(mapping({ $shape: [6, 7] }))).toEqual([])
  })

  it("stays quiet on a multi-key object — an output template, never a call", () => {
    expect(paths(mapping({ shape: "queue", type: "channel" }))).toEqual([])
  })

  it("stays quiet on a dynamic spelling, which is a call an author meant", () => {
    expect(paths(mapping({ shape: { var: "data.dims" } }))).toEqual([])
  })

  it("reports a constant `full` however it is shaped", () => {
    // Measured against a live 1.8.0 node: the server flags *both*, because
    // neither actually evaluates as a call on this build. An earlier version of
    // this lint exempted the constructor-looking one and was wrong to.
    expect(paths(mapping({ full: [[2, 3], 7, "i64"] }))).toHaveLength(1)
    expect(paths(mapping({ full: [1, 2] }))).toHaveLength(1)
  })

  it("stays quiet on the constant constructors outside the seven", () => {
    // `zeros` and `tensor` are working calls the server also stays quiet on —
    // here because they are not ordinary JSON keys, there because they evaluate.
    // Same answer, and that is what matters.
    expect(paths(mapping({ zeros: [[2], "i64"] }))).toEqual([])
    expect(paths(mapping({ tensor: [[1, 2], "i64"] }))).toEqual([])
  })

  it("reports each of the seven colliding names", () => {
    for (const op of COLLIDING_OPERATORS) {
      expect(paths(mapping({ [op]: [1, 2] })), `${op} should be reported`).toHaveLength(1)
    }
  })

  it("stays quiet on the thirteen nobody writes as data", () => {
    const noisy = TENSOR_OPERATORS.filter(
      (op) => !(COLLIDING_OPERATORS as readonly string[]).includes(op),
    )
    for (const op of noisy) {
      expect(paths(mapping({ [op]: [1, 2] })), `${op} should not be reported`).toEqual([])
    }
  })

  it("does not descend into a genuine call's argument list", () => {
    // `one_hot` is a real call; the `shape` inside it is its argument, not a
    // template position of its own.
    expect(paths(mapping({ one_hot: [{ shape: [6, 7] }, 3, "f32"] }))).toEqual([])
  })

  it("finds a key nested under ordinary data keys", () => {
    expect(paths(mapping({ board: { dims: { shape: [6, 7] } } }))).toEqual([
      "tasks[0].function.input.mappings[0].logic.board.dims.shape",
    ])
  })

  it("walks every mapping of a map task", () => {
    const steps = [
      {
        id: "m",
        name: "Map",
        function: {
          name: "map",
          input: {
            mappings: [
              { path: "data.a", logic: { ok: 1 } },
              { path: "data.b", logic: { cast: [1] } },
            ],
          },
        },
      },
    ]
    expect(paths(steps)).toEqual(["tasks[0].function.input.mappings[1].logic.cast"])
  })

  describe("template positions beyond map", () => {
    it("reads a catalogue field whose template_at is the value itself", () => {
      const steps = [
        {
          id: "i",
          name: "Infer",
          function: { name: "model_infer", input: { model: "m", input: { pad: [1, 2] } } },
        },
      ]
      expect(paths(steps)).toEqual(["tasks[0].function.input.input.pad"])
    })

    it("reads a member-wise template position", () => {
      const steps = [
        {
          id: "h",
          name: "Call",
          function: {
            name: "http_call",
            input: { connector: "c", headers: { "x-a": { concat: [1, 2] } } },
          },
        },
      ]
      expect(paths(steps)).toEqual(["tasks[0].function.input.headers.x-a.concat"])
    })

    it("ignores a field the catalogue does not mark as a template", () => {
      const steps = [
        {
          id: "i",
          name: "Infer",
          // `output` is a plain string field — a literal there is just data.
          function: { name: "model_infer", input: { model: "m", output: { shape: [1] } } },
        },
      ]
      expect(paths(steps)).toEqual([])
    })

    it("ignores a function the catalogue does not know", () => {
      const steps = [
        { id: "x", name: "X", function: { name: "acme.mystery", input: { a: { shape: [1] } } } },
      ]
      expect(paths(steps)).toEqual([])
    })
  })

  describe("the step tree", () => {
    it("keeps the coordinate through a task group", () => {
      const steps = [
        { id: "g", name: "Group", tasks: mapping({ shape: [6, 7] }) },
      ]
      expect(paths(steps)).toEqual([
        "tasks[0].tasks[0].function.input.mappings[0].logic.shape",
      ])
    })

    it("descends nested groups", () => {
      const steps = [
        { id: "g", name: "G", tasks: [{ id: "h", name: "H", tasks: mapping({ cast: [1] }) }] },
      ]
      expect(paths(steps)).toEqual([
        "tasks[0].tasks[0].tasks[0].function.input.mappings[0].logic.cast",
      ])
    })
  })

  describe("degenerate input", () => {
    it("returns nothing for a non-array", () => {
      expect(tensorKeyAdvisories(null, catalogue)).toEqual([])
      expect(tensorKeyAdvisories({}, catalogue)).toEqual([])
    })

    it("survives a step tree still being typed", () => {
      expect(paths([null, {}, { id: "a" }, { id: "b", function: {} }])).toEqual([])
    })

    it("survives an absent catalogue — map still works, the rest goes quiet", () => {
      expect(tensorKeyAdvisories(mapping({ shape: [6, 7] }), undefined)).toHaveLength(1)
    })
  })
})
