import { describe, expect, it } from "vitest"
import { parseEngineError } from "@/lib/trace-error"

describe("parseEngineError", () => {
  it("splits the QA Redis failure into code, task and cause", () => {
    expect(
      parseEngineError("FUNCTION_ERROR: Task bump_work.bump error: Function execution error: Redis INCRBY failed for key 'gen:work'"),
    ).toEqual({
      code: "FUNCTION_ERROR",
      taskId: "bump_work.bump",
      cause: "Redis INCRBY failed for key 'gen:work'",
      wrappers: ["Task bump_work.bump error", "Function execution error"],
    })
  })
  it("keeps a message without a code or task whole", () => {
    expect(parseEngineError("timed out after 5000ms")).toMatchObject({ code: null, taskId: null, cause: "timed out after 5000ms" })
  })
  it("reads a lower-case connector code", () => {
    expect(parseEngineError("circuit_open: soma-cache is open").code).toBe("circuit_open")
  })
})
