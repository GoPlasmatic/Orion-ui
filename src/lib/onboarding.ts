/**
 * The first-run path, as data: what a fresh instance needs before it does
 * anything, in the order the smoke flow does it, each step knowing whether it
 * is done. The dashboard shows it while nothing is live; the list pages'
 * empty states teach one primitive at a time, this is the whole route.
 */
export interface FirstRunState {
  workflows: number
  activeWorkflows: number
  channels: number
  activeChannels: number
  traces: number
}

export interface FirstRunStep {
  key: string
  title: string
  detail: string
  to: string
  done: boolean
}

export function firstRunSteps(s: FirstRunState): FirstRunStep[] {
  return [
    {
      key: "workflow",
      title: "Create a workflow",
      detail:
        "A pipeline of tasks, saved as a draft. Start from the one-task sample, or import a bundle.",
      to: "/workflows/new",
      done: s.workflows > 0,
    },
    {
      key: "activate-workflow",
      title: "Activate it",
      detail:
        "Pre-flight checks the functions and connectors it names; activation loads it into the engine.",
      to: "/workflows",
      done: s.activeWorkflows > 0,
    },
    {
      key: "channel",
      title: "Bind a channel to it",
      detail: "A REST route, a Kafka topic or a cron schedule that runs the workflow.",
      to: "/channels/new",
      done: s.channels > 0,
    },
    {
      key: "activate-channel",
      title: "Activate the channel",
      detail:
        "Needs an active workflow. Once live, the route is served and the System Map shows it.",
      to: "/channels",
      done: s.activeChannels > 0,
    },
    {
      key: "request",
      title: "Send a request and read its trace",
      detail:
        "The Data Console sends a test payload; the trace shows every task's input and output.",
      to: "/console",
      done: s.traces > 0,
    },
  ]
}

/** Nothing is live yet: the checklist is the dashboard's most useful content. */
export const isFirstRun = (s: Pick<FirstRunState, "activeChannels">): boolean =>
  s.activeChannels === 0
