import type { APIRequestContext } from "@playwright/test"

/**
 * Seeding a live Orion 2.0 server through its own admin API, the way
 * `orion-cli deployments apply` does: upload the definitions, plan the head's
 * manifest plus the new members against the head, and apply the reviewed
 * digest. The members already at the head are kept, so a local server's own
 * deployment survives a run.
 */

const ECHO = "e2e-echo"

/** Variant 1 is the seed; another variant is a changed workflow — a new digest, so a new revision of it. */
const echoWorkflow = (variant: number) => ({
  name: ECHO,
  tasks: [
    {
      id: "echo",
      function: { name: "map", input: { mappings: [{ path: "data.echoed", logic: variant === 1 ? true : variant }] } },
    },
  ],
})

const echoChannel = {
  name: ECHO,
  protocol: "rest",
  channel_type: "sync",
  methods: ["POST"],
  route_pattern: `/${ECHO}`,
}

interface Member {
  entity: { kind: string; id: string; revision: number }
  definition_digest: string
  requires?: { kind: string; id: string; revision: number }[]
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()} ${await res.text()}`)
  return (await res.json()) as T
}

/**
 * Deploy the echo workflow (`variant`) and channel, unless the head already
 * serves exactly that, and answer the channel's data path and the head
 * revision that serves it.
 */
export async function seedEcho(
  request: APIRequestContext,
  key: string,
  variant = 1,
): Promise<{ path: string; revision: number }> {
  const headers = { Authorization: `Bearer ${key}` }
  const upload = async (kind: string, definition: unknown) =>
    (await ok<{ digest: string }>(
      await request.post("/api/v2/admin/definitions", { headers, data: { kind, definition } }),
      `upload ${kind}`,
    )).digest
  const wf = await upload("workflow", echoWorkflow(variant))
  const ch = await upload("channel", echoChannel)

  const path = `/api/v2/data/${ECHO}`
  const revision = await applyOnHead(request, headers, "e2e seed", (members) => {
    const servedWf = members.find((m) => m.entity.kind === "workflow" && m.entity.id === ECHO)
    const servedCh = members.find((m) => m.entity.kind === "channel" && m.entity.id === ECHO)
    if (servedWf?.definition_digest === wf && servedCh?.definition_digest === ch) return null
    const others = members.filter((m) => m.entity.id !== ECHO)
    // The CLI's numbering: keep a member's revision while its digest is
    // unchanged, bump it otherwise.
    const revisionFor = (served: Member | undefined, digest: string) =>
      !served ? 1 : served.definition_digest === digest ? served.entity.revision : served.entity.revision + 1
    const wfRef = { kind: "workflow", id: ECHO, revision: revisionFor(servedWf, wf) }
    return [
      ...others,
      { entity: wfRef, definition_digest: wf, requires: [] },
      { entity: { kind: "channel", id: ECHO, revision: revisionFor(servedCh, ch) }, definition_digest: ch, requires: [wfRef] },
    ]
  })
  return { path, revision }
}

/**
 * Plan and apply `edit(head members)` on the head, as the CLI does; `null`
 * from `edit` means the head already serves what is wanted. Answers the head
 * revision that serves it.
 */
async function applyOnHead(
  request: APIRequestContext,
  headers: Record<string, string>,
  reason: string,
  edit: (members: Member[]) => Member[] | null,
): Promise<number> {
  const page = await ok<{ head_revision: number }>(
    await request.get("/api/v2/admin/deployments?limit=1", { headers }),
    "deployments",
  )
  const head = page.head_revision
  let members: Member[] = []
  if (head > 0) {
    const current = await ok<{ manifest?: { members: Member[] } }>(
      await request.get(`/api/v2/admin/deployments/${head}`, { headers }),
      "head",
    )
    members = current.manifest?.members ?? []
  }
  const next = edit(members)
  if (!next) return head
  const manifest = { schema_version: 2, providers: [], members: next }
  const plan = await ok<{ reviewed_manifest_digest: string }>(
    await request.post("/api/v2/admin/deployment-plans", { headers, data: { base_revision: head, manifest } }),
    "plan",
  )
  const applied = await ok<{ committed_revision: number }>(
    await request.post("/api/v2/admin/deployments", {
      headers,
      data: {
        idempotency_key: `e2e-${head}-${plan.reviewed_manifest_digest.slice(7, 23)}`,
        base_revision: head,
        manifest,
        reason,
        reviewed_manifest_digest: plan.reviewed_manifest_digest,
      },
    }),
    "apply",
  )
  return applied.committed_revision
}

export const E2E_CONNECTION = "e2e-cache"

/**
 * A connection over the built-in in-memory cache driver — it needs no backend,
 * so its probe is healthy anywhere — created at revision 1 (an identical
 * create answers the stored one) and deployed beside whatever the head serves.
 */
export async function seedConnection(request: APIRequestContext, key: string): Promise<number> {
  const headers = { Authorization: `Bearer ${key}` }
  const caps = await ok<{ provider_backends: { driver_id: string; package_digest?: string | null }[] }>(
    await request.get("/api/v2/admin/runtime-capabilities", { headers }),
    "runtime capabilities",
  )
  const provider = caps.provider_backends.find((b) => b.driver_id === "org.orion.memory-cache")?.package_digest
  if (!provider) throw new Error("this server composes no in-memory cache driver")
  const created = await ok<{ connection: { revision: number; configuration_digest: string } }>(
    await request.post(`/api/v2/admin/connections/${E2E_CONNECTION}/revisions`, {
      headers,
      data: { revision: 1, provider_digest: provider, public_config: {} },
    }),
    "create connection",
  )
  const { revision, configuration_digest } = created.connection
  return applyOnHead(request, headers, "e2e connection", (members) => {
    const served = members.find((m) => m.entity.kind === "connection" && m.entity.id === E2E_CONNECTION)
    if (served?.definition_digest === configuration_digest) return null
    return [
      ...members.filter((m) => !(m.entity.kind === "connection" && m.entity.id === E2E_CONNECTION)),
      { entity: { kind: "connection", id: E2E_CONNECTION, revision }, definition_digest: configuration_digest },
    ]
  })
}

/** Wait until the echo channel answers (the node converges on the new head by itself). */
export async function sendUntilServed(request: APIRequestContext, path: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const res = await request.post(path, { data: { data: { n: i } } })
    if (res.ok()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${path} never answered 200`)
}
