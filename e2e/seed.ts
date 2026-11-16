import type { APIRequestContext } from "@playwright/test"

/**
 * Seeding a live Orion 2.0 server through its own admin API, the way
 * `orion-cli deployments apply` does: upload the definitions, plan the head's
 * manifest plus the new members against the head, and apply the reviewed
 * digest. The members already at the head are kept, so a local server's own
 * deployment survives a run.
 */

const ECHO = "e2e-echo"

const echoWorkflow = {
  name: ECHO,
  tasks: [{ id: "echo", function: { name: "map", input: { mappings: [{ path: "data.echoed", logic: true }] } } }],
}

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

/** Deploy the echo workflow and channel (if the head does not already serve them) and answer the channel's data path. */
export async function seedEchoDeployment(request: APIRequestContext, key: string): Promise<string> {
  const headers = { Authorization: `Bearer ${key}` }
  const upload = async (kind: string, definition: unknown) =>
    (await ok<{ digest: string }>(
      await request.post("/api/v2/admin/definitions", { headers, data: { kind, definition } }),
      `upload ${kind}`,
    )).digest
  const wf = await upload("workflow", echoWorkflow)
  const ch = await upload("channel", echoChannel)

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
  const served = members.find((m) => m.entity.kind === "channel" && m.entity.id === ECHO)
  if (served?.definition_digest === ch) return `/api/v2/data/${ECHO}`

  const others = members.filter((m) => m.entity.id !== ECHO)
  const next = (kind: string) =>
    Math.max(0, ...members.filter((m) => m.entity.kind === kind && m.entity.id === ECHO).map((m) => m.entity.revision)) + 1
  const wfRef = { kind: "workflow", id: ECHO, revision: next("workflow") }
  const manifest = {
    schema_version: 2,
    providers: [],
    members: [
      ...others,
      { entity: wfRef, definition_digest: wf, requires: [] },
      { entity: { kind: "channel", id: ECHO, revision: next("channel") }, definition_digest: ch, requires: [wfRef] },
    ],
  }
  const plan = await ok<{ reviewed_manifest_digest: string }>(
    await request.post("/api/v2/admin/deployment-plans", { headers, data: { base_revision: head, manifest } }),
    "plan",
  )
  await ok(
    await request.post("/api/v2/admin/deployments", {
      headers,
      data: {
        idempotency_key: `e2e-${head}-${plan.reviewed_manifest_digest.slice(7, 23)}`,
        base_revision: head,
        manifest,
        reason: "e2e seed",
        reviewed_manifest_digest: plan.reviewed_manifest_digest,
      },
    }),
    "apply",
  )
  return `/api/v2/data/${ECHO}`
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
