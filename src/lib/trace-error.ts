/**
 * The shape of an engine error as Orion writes it onto a trace or an
 * occurrence: `FUNCTION_ERROR: Task bump_work.bump error: Function execution
 * error: Redis INCRBY failed for key 'gen:work'` — a code, then wrapper
 * phrases, then the cause. Three things read it (which step failed, what the
 * run lens says, how incidents group), so it is parsed here once.
 *
 * Prose is a fragile contract: the server should send `error_code` and
 * `failed_task_id` on the trace (asked upstream). Until then this is the one
 * place that knows the wording.
 */
export interface EngineError {
  /** `FUNCTION_ERROR`, `TIMEOUT_ERROR`, … or null when the message has no code. */
  code: string | null
  /** The task the message names (`Task <id> error`), or null. */
  taskId: string | null
  /** The message after the code and the wrapper phrases — what actually went wrong. */
  cause: string
  /** The wrapper phrases that were stripped, in order. */
  wrappers: string[]
}

const CODE = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z]+_[a-z_]+):\s*/
const TASK = /\bTask ([^\s:]+) error\b/
const WRAPPER = /^(?:(?:task|workflow|step) [^\s:]+ (?:error|failed)|(?:function|task|workflow) (?:execution )?error|execution error|error)$/i

export function parseEngineError(message: string | null | undefined): EngineError {
  const raw = (message ?? "").trim()
  let rest = raw
  let code: string | null = null
  const m = CODE.exec(rest)
  if (m) {
    code = m[1]
    rest = rest.slice(m[0].length)
  }
  const taskId = TASK.exec(raw)?.[1] ?? null
  const segments = rest.split(/:\s+/)
  const wrappers: string[] = []
  while (segments.length > 1 && WRAPPER.test(segments[0].trim())) wrappers.push(segments.shift()!.trim())
  return { code, taskId, cause: segments.join(": ").trim(), wrappers }
}
