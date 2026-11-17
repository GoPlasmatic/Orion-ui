import type {
  Channel,
  ChannelConfig,
  ChannelType,
  ManifestMember,
  Plugin,
  PluginManifest,
  Step,
  StoredDefinition,
  Workflow,
  WorkflowLoop,
} from "@/api/types"
import { sortMembers } from "@/lib/deployment-diff"

/**
 * What the head deploys, as entities: every channel, workflow and plugin
 * member over its stored definition. 2.0 has no entity listing — a node
 * serves exactly its manifest — so this projection is the registry the pages,
 * the map and the palette read.
 *
 * It mirrors the server's own (`orion-runtime/src/runtime/definitions.rs`:
 * `channel_row`, `workflow_row`, `plugin_row`): the identity comes from the
 * member (`id`, `revision`, the workflow a channel `requires`), everything
 * else from the definition. Pure, and tested against both halves.
 */
export interface DeployedRegistry {
  channels: Channel[]
  /** One per workflow id: the revision serving the most traffic (`primaryWorkflows`). */
  workflows: Workflow[]
  /** Every deployed workflow revision — more than one per id only under a canary split. */
  workflowRevisions: Workflow[]
  plugins: Plugin[]
  /** Connection members: no definition to read (their digest is a configuration digest). */
  connections: ManifestMember[]
  /** Members whose definition has not loaded (yet, or at all). */
  unresolved: ManifestMember[]
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** The workflow a channel member requires — the first, as the server reads it. */
export function requiredWorkflow(member: ManifestMember): string | null {
  return member.requires?.find((r) => r.kind === "workflow")?.id ?? null
}

export function channelFromMember(member: ManifestMember, definition: Record<string, unknown>): Channel {
  return {
    channel_id: member.entity.id,
    revision: member.entity.revision,
    digest: member.definition_digest,
    member,
    name: str(definition.name) ?? member.entity.id,
    description: str(definition.description),
    channel_type: (str(definition.channel_type) ?? "sync") as ChannelType,
    protocol: (str(definition.protocol) ?? "rest").toLowerCase(),
    route_pattern: str(definition.route_pattern),
    methods: Array.isArray(definition.methods) ? strings(definition.methods) : null,
    transport_config: record(definition.transport_config),
    workflow_id: requiredWorkflow(member),
    config: record(definition.config) as ChannelConfig,
    priority: int(definition.priority),
    tags: strings(definition.tags),
    rollouts: member.rollouts?.length ? member.rollouts : undefined,
  }
}

export function workflowFromMember(member: ManifestMember, definition: Record<string, unknown>): Workflow {
  const loop = definition.loop
  return {
    workflow_id: member.entity.id,
    revision: member.entity.revision,
    digest: member.definition_digest,
    member,
    name: str(definition.name) ?? member.entity.id,
    description: str(definition.description),
    priority: int(definition.priority),
    tags: strings(definition.tags),
    condition: definition.condition as Workflow["condition"],
    on_failure: str(definition.on_failure) ?? undefined,
    tasks: (Array.isArray(definition.tasks) ? definition.tasks : []) as Step[],
    loop: loop && typeof loop === "object" ? (loop as WorkflowLoop) : undefined,
  }
}

export function pluginFromMember(member: ManifestMember, stored: StoredDefinition): Plugin {
  const definition = stored.definition
  const manifest = record(definition.manifest) as PluginManifest
  return {
    plugin_id: member.entity.id,
    revision: member.entity.revision,
    digest: member.definition_digest,
    member,
    manifest,
    functions: (manifest.functions ?? []).map((f) => f.name).filter((n): n is string => typeof n === "string"),
    abi: str(manifest.abi) ?? "",
    plugin_version: str(manifest.version) ?? "",
    signature: str(definition.signature),
    tags: strings(definition.tags),
    component_digest: stored.component?.digest,
    component_bytes: stored.component?.size_bytes,
  }
}

/**
 * Bucket share each workflow revision serves, keyed `id@revision`: a
 * channel's rollout intervals, or all 100 buckets for the revision a channel
 * without a split requires. Summed across every channel routing to it.
 */
export function workflowShares(channels: Channel[]): Map<string, number> {
  const out = new Map<string, number>()
  const add = (key: string, n: number) => out.set(key, (out.get(key) ?? 0) + n)
  for (const c of channels) {
    if (!c.workflow_id) continue
    if (c.rollouts?.length) {
      for (const r of c.rollouts) add(`${c.workflow_id}@${r.workflow_revision}`, r.end_bucket - r.start_bucket)
    } else {
      const ref = c.member.requires?.find((r) => r.kind === "workflow")
      if (ref) add(`${ref.id}@${ref.revision}`, 100)
    }
  }
  return out
}

/**
 * One revision per workflow id: the one serving the most buckets, the newest
 * on a tie (or when no channel routes to any). What a page that shows "the"
 * workflow — the map, retry safety, the palette — reads; the workflow page
 * shows every revision.
 */
export function primaryWorkflows(revisions: Workflow[], shares: ReadonlyMap<string, number>): Workflow[] {
  const best = new Map<string, Workflow>()
  const share = (w: Workflow) => shares.get(`${w.workflow_id}@${w.revision}`) ?? 0
  for (const w of revisions) {
    const cur = best.get(w.workflow_id)
    if (!cur || share(w) > share(cur) || (share(w) === share(cur) && w.revision > cur.revision)) best.set(w.workflow_id, w)
  }
  return [...best.values()].sort((a, b) => a.workflow_id.localeCompare(b.workflow_id))
}

/** Build the registry from the head's members and whatever definitions have loaded. */
export function buildRegistry(
  members: ManifestMember[],
  definitionOf: (digest: string) => StoredDefinition | undefined,
): DeployedRegistry {
  const channels: Channel[] = []
  const workflowRevisions: Workflow[] = []
  const plugins: Plugin[] = []
  const connections: ManifestMember[] = []
  const unresolved: ManifestMember[] = []
  for (const m of sortMembers(members)) {
    if (m.entity.kind === "connection") {
      connections.push(m)
      continue
    }
    const stored = definitionOf(m.definition_digest)
    if (!stored || stored.kind !== m.entity.kind) {
      unresolved.push(m)
      continue
    }
    if (m.entity.kind === "channel") channels.push(channelFromMember(m, stored.definition))
    else if (m.entity.kind === "workflow") workflowRevisions.push(workflowFromMember(m, stored.definition))
    else if (m.entity.kind === "plugin") plugins.push(pluginFromMember(m, stored))
  }
  workflowRevisions.sort((a, b) => a.workflow_id.localeCompare(b.workflow_id) || b.revision - a.revision)
  return {
    channels,
    workflows: primaryWorkflows(workflowRevisions, workflowShares(channels)),
    workflowRevisions,
    plugins,
    connections,
    unresolved,
  }
}

/** The channels whose member requires this workflow (any revision of it). */
export function channelsRunning(registry: Pick<DeployedRegistry, "channels">, workflowId: string): Channel[] {
  return registry.channels.filter((c) => c.member.requires?.some((r) => r.kind === "workflow" && r.id === workflowId))
}

/**
 * A revision as one self-contained JSON document: its manifest and every
 * stored definition the manifest names, keyed by digest — what the CLI's
 * `compile` output carries, so it can be read, diffed or re-applied
 * elsewhere. Connection members name configuration digests, which are not
 * definitions, so they travel as the manifest alone. Plugin components are
 * kept as the server stores them (base64): an export must be complete.
 */
export async function revisionBundle(
  revision: { revision: number; manifest_digest: string; manifest: { members: ManifestMember[] } },
  fetchDefinition: (digest: string) => Promise<StoredDefinition>,
) {
  const digests = [
    ...new Set(revision.manifest.members.filter((m) => m.entity.kind !== "connection").map((m) => m.definition_digest)),
  ]
  const definitions: Record<string, StoredDefinition> = {}
  for (const d of digests) definitions[d] = await fetchDefinition(d)
  return {
    revision: revision.revision,
    manifest_digest: revision.manifest_digest,
    manifest: revision.manifest,
    definitions,
  }
}
