/**
 * A deployed head for tests: give it channels, workflows and plugins (as the
 * registry projects them) and it serves the manifest and definitions the
 * registry would have read them from. Tests mock the two API modules with
 * these factories, so a page runs its real hooks over a fake server:
 *
 *   vi.mock("@/api/deployments", async () => (await import("@/test/deployed-api")).deploymentsModule())
 *   vi.mock("@/api/definitions", async () => (await import("@/test/deployed-api")).definitionsModule())
 *   beforeEach(() => setDeployed({ channels: [...], workflows: [...] }))
 */
import type {
  Channel,
  DeploymentRevision,
  DeploymentsPage,
  ManifestMember,
  Plugin,
  StoredDefinition,
  Workflow,
} from "@/api/types"

interface Deployed {
  revision: DeploymentRevision | null
  definitions: Map<string, StoredDefinition>
}

const state: Deployed = { revision: null, definitions: new Map() }

const HEAD = 1

let next = 0
const digest = () => `sha256:${(++next).toString(16).padStart(64, "0")}`

/** A channel as the registry projects it, with a member built from its fields. */
export function deployedChannel(c: Partial<Channel> & { channel_id: string }): Channel {
  const d = c.digest ?? digest()
  const revision = c.revision ?? 1
  const workflow_id = c.workflow_id ?? null
  return {
    name: c.channel_id,
    description: null,
    channel_type: "sync",
    protocol: "rest",
    route_pattern: null,
    methods: null,
    transport_config: {},
    config: {},
    priority: 0,
    tags: [],
    ...c,
    workflow_id,
    revision,
    digest: d,
    member: c.member ?? {
      entity: { kind: "channel", id: c.channel_id, revision },
      definition_digest: d,
      requires: workflow_id ? [{ kind: "workflow", id: workflow_id, revision: 1 }] : [],
      ...(c.rollouts ? { rollouts: c.rollouts } : {}),
    },
  }
}

/** A workflow as the registry projects it. */
export function deployedWorkflow(w: Partial<Workflow> & { workflow_id: string }): Workflow {
  const d = w.digest ?? digest()
  const revision = w.revision ?? 1
  return {
    name: w.workflow_id,
    description: null,
    priority: 0,
    tags: [],
    tasks: [],
    ...w,
    revision,
    digest: d,
    member: w.member ?? { entity: { kind: "workflow", id: w.workflow_id, revision }, definition_digest: d, requires: [] },
  }
}

/** A plugin as the registry projects it. */
export function deployedPlugin(p: Partial<Plugin> & { plugin_id: string }): Plugin {
  const d = p.digest ?? digest()
  const revision = p.revision ?? 1
  return {
    manifest: {},
    functions: [],
    abi: "orion:plugin@1.0.0",
    plugin_version: "0.1.0",
    tags: [],
    ...p,
    revision,
    digest: d,
    member: p.member ?? { entity: { kind: "plugin", id: p.plugin_id, revision }, definition_digest: d },
  }
}

const omit = <T extends object>(o: T, keys: (keyof T)[]) => {
  const out: Record<string, unknown> = { ...(o as Record<string, unknown>) }
  for (const k of keys) delete out[k as string]
  return out
}

/** Make the fake server deploy exactly these entities (or nothing, with no argument). */
export function setDeployed(entities?: {
  channels?: Channel[]
  workflows?: Workflow[]
  plugins?: Plugin[]
  /** Connection members by id (their digest names a configuration, not a definition). */
  connections?: string[]
}) {
  state.definitions = new Map()
  if (!entities) {
    state.revision = null
    return
  }
  const members: ManifestMember[] = []
  for (const c of entities.channels ?? []) {
    members.push(c.member)
    state.definitions.set(c.digest, {
      kind: "channel",
      definition: omit(c, ["channel_id", "revision", "digest", "member", "workflow_id", "rollouts"]),
    })
  }
  for (const w of entities.workflows ?? []) {
    members.push(w.member)
    state.definitions.set(w.digest, {
      kind: "workflow",
      definition: omit(w, ["workflow_id", "revision", "digest", "member"]),
    })
  }
  for (const p of entities.plugins ?? []) {
    members.push(p.member)
    state.definitions.set(p.digest, {
      kind: "plugin",
      definition: { manifest: p.manifest, component: "AA==", signature: p.signature ?? null, tags: p.tags },
    })
  }
  for (const id of entities.connections ?? []) {
    members.push({ entity: { kind: "connection", id, revision: 1 }, definition_digest: digest() })
  }
  state.revision = {
    revision: HEAD,
    manifest_digest: "sha256:manifest",
    member_count: members.length,
    reason: "test",
    created_by: "test",
    members_compacted: false,
    created_at: "2026-11-16T00:00:00Z",
    manifest: { schema_version: 2, providers: [], members },
  }
}

export function deploymentsModule() {
  const page = (): DeploymentsPage => {
    const head = state.revision ? HEAD : 0
    return {
      head_revision: head,
      epoch: 1,
      applied_revision: head,
      data: state.revision ? [state.revision] : [],
      limit: 20,
      next_cursor: null,
    }
  }
  return {
    deploymentsApi: {
      list: async () => page(),
      get: async (revision: number) => {
        if (!state.revision || revision !== HEAD) throw new Error(`no revision ${revision}`)
        return state.revision
      },
      convergence: async (revision: number) => ({
        converged: true,
        target_revision: revision,
        converged_nodes: ["n1"],
        pending_nodes: [],
        degraded_nodes: [],
      }),
      plan: async () => {
        throw new Error("not in this fixture")
      },
      rollback: async () => {
        throw new Error("not in this fixture")
      },
    },
  }
}

export function definitionsModule() {
  return {
    definitionsApi: {
      get: async (d: string) => {
        const def = state.definitions.get(d)
        if (!def) throw new Error(`no definition ${d}`)
        return def
      },
      test: async () => {
        throw new Error("not in this fixture")
      },
    },
  }
}
