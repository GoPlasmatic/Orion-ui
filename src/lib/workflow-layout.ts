import type { Node, Edge } from "@xyflow/react"
import type { Rule } from "@/api/types"

interface Task {
  id: string
  name: string
  function: {
    name: string
    input: Record<string, unknown>
  }
  condition?: Record<string, unknown> | boolean
}

export type TaskNodeData = {
  taskId: string
  name: string
  functionName: string
  hasCondition: boolean
  conditionSummary?: string
  connectorName?: string
  mappingCount?: number
}

export type ConditionNodeData = {
  conditionSummary: string
}

const NODE_HEIGHT = 80
const NODE_GAP = 60
const START_Y = 0

function summarizeCondition(condition: Record<string, unknown> | boolean | null | undefined): string {
  if (condition === null || condition === undefined) return "Always"
  if (typeof condition === "boolean") return condition ? "Always" : "Never"
  if (Object.keys(condition).length === 0) return "Always"
  const op = Object.keys(condition)[0]
  if (op === "and" || op === "or") {
    const clauses = condition[op] as unknown[]
    return `${op.toUpperCase()} (${clauses.length} conditions)`
  }
  if (op === "==" || op === "===" || op === "!=" || op === ">" || op === "<" || op === ">=" || op === "<=") {
    const args = condition[op] as unknown[]
    if (Array.isArray(args) && args.length === 2) {
      const left = typeof args[0] === "object" && args[0] !== null && "var" in args[0]
        ? `$${(args[0] as { var: string }).var}`
        : JSON.stringify(args[0])
      const right = typeof args[1] === "object" && args[1] !== null && "var" in args[1]
        ? `$${(args[1] as { var: string }).var}`
        : JSON.stringify(args[1])
      return `${left} ${op} ${right}`
    }
  }
  if (op === "if") return "Conditional"
  if (op === "!!" || op === "!") {
    const arg = condition[op]
    if (typeof arg === "object" && arg !== null && "var" in arg) {
      return `${op === "!" ? "NOT " : ""}$${(arg as { var: string }).var}`
    }
  }
  return `${op}(...)`
}

function getTaskFunctionName(task: Task): string {
  return task.function.name
}

function getMappingCount(task: Task): number | undefined {
  if (task.function.name !== "map") return undefined
  const input = task.function.input
  if (input?.mappings && Array.isArray(input.mappings)) return input.mappings.length
  if (input?.mapping && typeof input.mapping === "object") return Object.keys(input.mapping).length
  return undefined
}

function getConnectorName(task: Task): string | undefined {
  const input = task.function.input
  if (!input) return undefined
  if (typeof input.connector === "string") return input.connector
  if (typeof input.connector_name === "string") return input.connector_name
  return undefined
}

function parseJson<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export function ruleToFlowElements(rule: Rule): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let y = START_Y

  const condition = parseJson<Record<string, unknown> | boolean>(rule.condition_json)
  const tasks = parseJson<Task[]>(rule.tasks_json) ?? []

  // Entry condition node
  const conditionSummary = summarizeCondition(condition)
  nodes.push({
    id: "condition-entry",
    type: "conditionNode",
    position: { x: 0, y },
    data: { conditionSummary } satisfies ConditionNodeData,
    draggable: false,
  })
  y += NODE_HEIGHT + NODE_GAP

  // Task nodes
  let prevId = "condition-entry"
  for (const task of tasks) {
    const nodeId = `task-${task.id}`
    const hasCondition = task.condition !== undefined
      && task.condition !== null
      && task.condition !== true
      && (typeof task.condition !== "object" || Object.keys(task.condition).length > 0)
    const fnName = getTaskFunctionName(task)

    nodes.push({
      id: nodeId,
      type: "taskNode",
      position: { x: 0, y },
      data: {
        taskId: task.id,
        name: task.name,
        functionName: fnName,
        hasCondition,
        conditionSummary: hasCondition ? summarizeCondition(task.condition as Record<string, unknown>) : undefined,
        connectorName: getConnectorName(task),
        mappingCount: getMappingCount(task),
      } satisfies TaskNodeData,
      draggable: false,
    })

    edges.push({
      id: `edge-${prevId}-${nodeId}`,
      source: prevId,
      target: nodeId,
      type: "smoothstep",
      animated: hasCondition,
      style: hasCondition ? { strokeDasharray: "5 5" } : undefined,
    })

    prevId = nodeId
    y += NODE_HEIGHT + NODE_GAP
  }

  return { nodes, edges }
}
