import { api } from "./client"
import type { StoredDefinition, TestDefinitionRequest, TestDefinitionResponse } from "./types"

/**
 * Content-addressed definitions (2.0). A definition has no id, version or
 * status of its own — a manifest member binds it to an entity. Its digest
 * covers the whole document, so a fetched definition never changes: callers
 * cache it forever. There is no list: definitions are reached through the
 * manifests that name them. Every answer is bare.
 */
export const definitionsApi = {
  get: (digest: string) => api.get<StoredDefinition>(`admin/definitions/${encodeURIComponent(digest)}`),

  /**
   * Run a workflow definition once on this node's engine, without deploying
   * it: its functions, plugins and connectors are live, so tasks reach real
   * backends. Refuses (400) what an upload would refuse. A run that stopped
   * short still answers 200 with its trace and `error`. Audited
   * (`v2_definition_test`) before it runs. It reaches live backends, so it
   * counts as a mutation: a read-only key is refused with 403.
   */
  test: (req: TestDefinitionRequest) => api.post<TestDefinitionResponse>("admin/definitions/test", req),
}
