/**
 * The first-run path, as data: what a fresh 2.0 instance needs before it does
 * anything, each step knowing whether it is done. In 2.0 a service arrives as
 * a deployment — definitions compiled from a directory and applied with
 * `orion-cli` — so the first two steps are commands, not pages. The dashboard
 * shows the path while nothing is served.
 */
export interface FirstRunState {
  /** The deployment head; 0 before the first apply. */
  headRevision: number
  /** The revision this node serves; 0 before it served any. */
  appliedRevision: number
  /** Channels the head deploys. */
  channels: number
  traces: number
}

export interface FirstRunStep {
  key: string
  title: string
  detail: string
  /** The command that does it, when the step happens outside the console. */
  command?: string
  to: string
  done: boolean
}

export function firstRunSteps(s: FirstRunState): FirstRunStep[] {
  const applied = s.headRevision > 0
  return [
    {
      key: "compile",
      title: "Compile a definition set",
      detail: "Workflows, channels and connections as files in a directory, checked and compiled into a deployment.",
      command: "orion-cli compile ./definitions -o dist/deployment",
      to: "/deployments",
      done: applied,
    },
    {
      key: "apply",
      title: "Apply it",
      detail: "Plans the deployment against the head, then commits it as the next revision.",
      command: "orion-cli deployments apply -d dist/deployment",
      to: "/deployments",
      done: applied,
    },
    {
      key: "converge",
      title: "Watch it converge",
      detail: "This node rebuilds onto the new head by itself; the revision page shows which nodes serve it.",
      to: applied ? `/deployments/${s.headRevision}?tab=convergence` : "/deployments",
      done: applied && s.appliedRevision === s.headRevision && s.channels > 0,
    },
    {
      key: "request",
      title: "Send a request and read its trace",
      detail: "The Data Console sends a test payload; the trace shows every task's input and output.",
      to: "/console",
      done: s.traces > 0,
    },
  ]
}

/** Nothing is served yet: the checklist is the dashboard's most useful content. */
export const isFirstRun = (s: Pick<FirstRunState, "headRevision" | "channels">): boolean =>
  s.headRevision === 0 || s.channels === 0
