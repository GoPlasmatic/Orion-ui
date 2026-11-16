# Orion-ui 2.0: implementation plan

Status: Phases 0 and 1 done on branch `v2` (2026-11-16); Phase 5 deferred to 2.1 (D1 = A). Target: Orion `v2.0.0` (Orion `main` @ `1e58099f`, not yet tagged).

## Goal and definition of done

Orion-ui 2.0.0 is a console for an Orion 2.0 server (`/api/v2`), and it ships in the same release as the server.

The work is done when all of the following hold:

1. Every screen calls only endpoints in the vendored 2.0 spec. `npm run check:contract` and `src/api/contract.test.ts` both pass against that spec.
2. A user can see what is deployed, compare revisions, roll back, and watch convergence. They can also inspect workflows, channels, plugins and connections, test a workflow, probe a connection, and manage provider packages. With decision D1 = B, they can also author a change and apply it.
3. The console works with admin auth on (full keys and read-only keys) and with admin auth off.
4. Standard+ features (rollouts, the ext providers) render as neutral facts on a Community server and work on `orion-ext`.
5. `npm run lint`, `npm run build`, `npm test` and the rewritten Playwright smoke suite all pass against an Orion 2.0 server in CI.
6. The version is `2.0.0`, the CHANGELOG is cut, README/CLAUDE.md/PRODUCT.md describe the 2.0 contract, and the image `ghcr.io/goplasmatic/orion-ui:2.0.0` builds.

## Where we start

- `main` = `v1.12.1`. It targets the 1.12 API: 68 paths, all under `/api/v1`, with 124 call sites.
- The local branch `dataflow-4` (`f106776`, not pushed) holds dataflow-rs 4 work that 2.0 needs:
  - trace `{initial, steps}` replay
  - `on_failure`/`on_rejection` step policies
  - the catalogue without `aliases`
- About 50k lines of TS. `src/api/types.ts` is hand-written (2.5k lines). `schema.d.ts` serves only as a contract fingerprint.
- There are about 395 unit tests and one serial Playwright smoke file (20 tests) that runs against a live server. CI currently uses `ghcr.io/goplasmatic/orion:1.12.0`.

## What changed in the server, as it affects the UI

| 1.12 surface the UI uses | 2.0 | UI consequence |
|---|---|---|
| CRUD + status + versions + import/export + validate + dependencies for workflows, channels, plugins | Gone. Content-addressed **definitions** (`POST/GET /definitions[/{digest}]`, no list) bound into an immutable, numbered **deployment manifest** (`/deployments`, `/deployment-plans`) | Rebuild these pages as views of the deployed head; any change goes through plan → apply |
| `workflows/{id}/rollout` (percentage) | A channel member's `rollouts: [{workflow_revision, start_bucket, end_bucket}]` in the manifest; Standard+ only | The rollout editor becomes part of a manifest change, gated on `edition` |
| `workflows/{id}/test` | `POST /definitions/test` (full definition in the body) | Test the deployed definition, or an edited copy, without deploying |
| connectors CRUD + `/test` | **Connections**: immutable revisions + `/probes` | Connections pages: revisions, probe, which revision is deployed |
| models + `/admit` | Removed from Community; becomes the `com.orion.models` provider (ext) | Delete the models pages; models appear as a connection |
| `/admin/packages` receipts | Removed. `/connector-packages` covers provider packages (upload, admit, revoke) | Replace the Packages page with a Provider Packages page |
| `engine/reload` | Removed; applying a deployment reloads, and `/convergence` reports progress | Remove the reload button; add a convergence panel |
| Offset pagination, `sort_by` | Cursor pagination `{data, limit, next_cursor, total?}`, newest first | New list primitive; drop sort controls the server no longer supports |
| Every 2xx wrapped in `{data}` | Old resources still wrapped; new v2 resources (definitions, deployments, plans, connections, packages, capabilities) return **bare** objects | The client needs both unwrap modes, per endpoint |
| Zoneless UTC timestamps | RFC 3339 with `Z` | `formatDate` must accept both (drop the "assume UTC" patch-up) |
| No auth assumed | `Authorization: Bearer` (or a configured header); read-only keys; required in production | Key entry, a 401/403 flow, and hiding mutating verbs for read-only keys |
| `engine/status.capabilities` | `GET /runtime-capabilities` (edition, drivers, provider backends, node status, deployment head) | A new single source for capability and edition gating |

Surfaces that survive with small changes:
- traces: `duration_ms` is now a number; `offset` and sort are gone; `mode` is `sync|async|cron`
- trace DLQ: `payload` and `metadata` are now objects; cursor paging
- cron occurrences: cursor paging
- audit logs: cursor paging; new `v2_*` action names
- backups: POST returns 201; `modified_at` becomes `created_at`
- cache invalidate and circuit breakers: no shape changes
- `engine/status`: `models` removed
- `functions`: becomes `CatalogueEntry`; `plugin` added; `retry_safety` is an object; untyped built-ins added
- `channels/{id}/trigger`, `data/*`: unchanged
- health: `/healthz` and `/readyz` now have their own shapes; the `components` keys changed

For the field-level detail, diff `components.schemas` between the old and new `contracts/openapi.json` while transcribing `types.ts`; `schema.d.ts` regenerated from each is the quickest side-by-side.

## Decisions to make before Phase 2

**Decided 2026-11-16:** D1 = **A** (operate: inspect, compare, roll back, test, probe, manage
provider packages; Phase 5 moves to 2.1). D2 = **c** (implemented in Phase 0). D3: tag Orion
first, then the UI once its e2e passes against `orion:2.0.0`.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | How much can the UI change? | **A.** Operate: inspect, compare, roll back, test, probe, manage provider packages. Authoring stays in Git + `orion-cli deployments apply`. **B.** A + a change-set editor: edit or add members in the browser, upload definitions, plan, apply. | **A for 2.0.0, B as 2.1.** 2.0's model is deployment-as-code, and a browser editor competes with the Git source of truth (it creates drift from the repo). A is about 60% of the effort and complete in its own right. If you want B in 2.0.0, Phase 5 is written to drop in. |
| D2 | How does the browser authenticate? | **a.** The user pastes a key, held in `sessionStorage` via `storage.ts` and sent as `Authorization: Bearer`. **b.** nginx injects `ORION_ADMIN_AUTHORIZATION` (`Bearer <key>`) into requests that carry no key (the browser holds no secret, but anyone who reaches the UI is an admin). **c.** Both: (b) when set, else (a). | **c.** (a) is the default for dev and shared servers; (b) suits deployments behind an SSO proxy. Read-only keys work with either. *Implemented in Phase 0.* |
| D3 | Does the UI's release gate the Orion tag? | Tag Orion when the server is ready and release the UI after it, or hold the Orion tag for the UI | The UI pins a server image, so the server can tag first. You've said you want the UI in this release, so plan for: tag Orion → CI e2e against `orion:2.0.0` → tag the UI. Until the Orion tag exists, CI builds the server from source (see Phase 0). |

## New information architecture

| Section | Pages (2.0) | Was |
|---|---|---|
| Monitor | Operations, System Map, Traces, Schedules | same (data sources change) |
| **Deploy** (new) | **Deployments** (history), **Revision** (members, diff, convergence, rollback) | Engine reload, Packages |
| Build | Workflows, Channels, Plugins: read-only views of the head; Data Console | CRUD lists and forms |
| Connect (new name) | **Connections**, **Provider Packages** (+ authoring tools) | Connectors, Models |
| Control | Caches, Trace DLQ, Circuit Breakers, Engine (status, runtime capabilities, node, backups) | same, minus reload |
| Govern | Audit Log | same; Packages moves to Deploy |

Old routes (`/models/*`, `/packages`, `*/new`, `*/edit`) redirect to their nearest 2.0 page and show a one-line notice instead of a 404.

## Phases

Sizes are relative: S ≈ 1–2 days, M ≈ 3–5, L ≈ 6–10, for one engineer familiar with the codebase. Phases 1, 2 and 4 can run in parallel once Phase 0 lands.

### Phase 0: Foundations (M)

1. **Branching.** Branch `v2` from `dataflow-4`. *Done differently from the first draft:* `dataflow-4` is not merged into `main`, because its linter rejects the 1.x step keys a 1.12 server still serves, and `main` is the 1.12 release line. `v2` merges to `main` when the port ships.
2. **Libraries.** Upgrade `@goplasmatic/dataflow-ui` to `4.0.x` and `@goplasmatic/datalogic-ui` to `5.9.x`, then delete the 3.x back-translation in `lib/workflow-mapper.ts`. CLAUDE.md calls it a "stopgap".
3. **Contract.**
   - Vendor `Orion-docs/openapi.json` (2.0.0, 44 paths) into `contracts/openapi.json`. Orion 2.0 no longer ships `docs/openapi.json`; the spec is generated in Orion-docs (`cargo run --manifest-path drift/Cargo.toml --bin dump-openapi`). Update the copy command in CLAUDE.md's "Server contract" section, and the note that the server serves `/api/v1/openapi.json`.
   - Re-check `contracts/patch-spec.mjs`. If `OnConflict` and `ReloadMode` are gone, the patch is no longer needed; delete it and update `PATCHES.md`.
   - Run `npm run generate:api`.
4. **Client** (`src/api/client.ts`):
   - `API_BASE = "/api/v2"`.
   - Per-call `envelope: "data" | "bare"`. Default to `data`; the v2 resource modules pass `bare`. A unit test asserts each module's choice against the spec's response schema (wrapped `Data_*` vs bare).
   - Auth (D2): `Authorization: Bearer <key>`, with the header name configurable. The key lives in `sessionStorage`, never `localStorage`, behind a session pair added to `lib/storage.ts` (it stays the only file that touches browser storage).
     - 401 opens the key dialog.
     - 403 `FORBIDDEN` on a mutating call marks the session read-only and re-renders.
     - Surface the lock-out on repeated failures as a `retry-after` message.
   - Error envelope: add `connector{class, provider_code, retryable}` and `details[].{expected, got}`, and render them in `ErrorState` and `toastError`.
   - `X-Orion-Change-Context` stays and goes on every mutating call (deploy and rollback especially).
5. **Pagination.**
   - Replace `PaginatedResponse` with `Page<T> = {data, limit, next_cursor?, total?}`.
   - Add `useCursorList` (react-query `useInfiniteQuery`) for "Load more" and an optional count (`include_total=true`, requested only where the UI shows a total).
   - Rework `useListState`/`useUrlFilters` and `EntityTable` to work without offset and server sort. Sort client-side within the loaded pages, and say so in the column header tooltip.
6. **Time.** `formatDate` and the cron helpers parse RFC 3339 with `Z`, and still accept zoneless input for one release.
7. **Capabilities single source.** Add `api/runtime.ts` + `hooks/use-runtime-capabilities.ts`, giving:
   - `edition`, `channel_drivers`, `provider_backends`, `node_status`, `deployment_head`, `native_scheduler`
   - `useEdition()` / `useFeature("rollouts")` replace the `capability:` flags in `nav.ts` and the sidebar.
   - Read-only session state lives beside it: `useCanMutate()`.
8. **Health.** Separate `HealthResponse` / `ReadinessResponse` / `LivenessResponse` types, and the new `components` keys (`background_tasks, engine_reload, plugins, cron`; `kafka`, `cluster_redis` and `packages` are gone). The header and sidebar health indicator reads `/health` and also `/readyz` `cluster_store` when present.
9. **Dev and CI server.**
   - `docker-compose.yml` already builds `../Orion` from source, which is fine for dev.
   - CI e2e: until `ghcr.io/goplasmatic/orion:2.0.0` exists, build the image from `GoPlasmatic/Orion@1e58099f` in the job (with a GHA cache, as Ext's HA drill does), and switch to the tag once it is published.
   - Add an admin key to the CI server so e2e covers auth.
10. **Contract test.** Empty `INVOCATIONS` and rebuild it module by module as Phases 1–4 land. The completeness check keeps the work honest.

Acceptance: the app boots against a 2.0 server; health, engine status, runtime capabilities and the key dialog work; the contract test passes for the modules ported so far.

**Phase 0 outcome (2026-11-16).** Done on `v2`, with these departures from the steps above:
- Pagination: `Page<T>`, `useCursorList` and `LoadMoreFooter` exist with tests. `useListState` and `EntityTable` still carry offset and sort, because the pages that use them are 1.12 pages; each page moves to the cursor list when Phase 1, 3 or 4 ports its module, and the offset path is deleted with its last caller.
- Time: nothing to do. `parseServerDate` already reads an instant with `Z` as is and a zoneless one as UTC.
- Health: the types and docs follow 2.0 (`HealthResponse` components, `ReadinessResponse`, `LivenessResponse`, `fetchReadiness`). Rendering `/readyz`'s `cluster_store` is Phase 1's Engine page.
- Contract test: rather than emptying `INVOCATIONS`, every 1.12 call is listed in `PENDING_V2` (71 calls) and held to *still failing*, so the list can only shrink. The test also checks each function's envelope against the spec (`Data_*` unwrapped; bare and `Page_*` not).
- Auth: a request without a key counts toward the server's lockout, so the client sends one probe before any admin request and then holds requests back until a key is entered. Without this, the dashboard's first burst of requests would lock the browser out.
- E2E: `e2e/foundations.spec.ts` (key flow with one probe, wrong then right key, `/api/v2` only, read-only learned from a refused backup) passes against a local 2.0 server. The 1.12 `smoke.spec.ts` is excluded until Phase 7. CI builds `orion-server` from `1e58099f` and runs it with admin auth on.
- Also done: dataflow-ui 4.0.3 / datalogic-ui 5.9.0 / `@xyflow/react` 12.12.0; the structure-lens click workaround is replaced by `initialSelection`; the spec patch script is deleted (2.0's spec resolves as published).

### Phase 1: Port the surviving surfaces (M)

Each item: transcribe the types, port the API module, update the hooks and page, add the `INVOCATIONS` rows, and update unit tests.

- **Traces / trace detail:**
  - cursor-only paging
  - remove the sort controls
  - `mode` filter `sync|async|cron`
  - `duration_ms` as a number
  - show `X-Orion-Workflow-Revision` if present
  - trace → "deployed revision" link (a Phase 2 dependency; stub it)
- **Trace DLQ:** cursor paging; `payload` and `metadata` as objects (delete the JSON-string parsing); `DlqPurgeResponse`.
- **Schedules / occurrence detail:** cursor paging; channel ids are now deployed channel entity ids; trigger, retry and cancel are unchanged.
- **Audit:**
  - cursor paging
  - rewrite `audit-vocabulary.ts` for the `v2_*` actions (`v2_deployment_apply`, `v2_deployment_rollback`, `v2_definition_upload`, `v2_connection_create`, `v2_package_admit`, …)
  - `audit-routes.ts::entityRoute` maps deployments to `/deployments/:rev` and connections and packages to their new pages
  - show `details.change_context`
- **Engine:**
  - remove reload and models
  - add the runtime-capabilities panel: edition, drivers, provider backends, scheduler, node status with quarantined entities and `last_error`
  - backups: 201 and `created_at`
- **Caches, circuit breakers:** schema renames only.
- **Functions catalogue:**
  - `CatalogueEntry`
  - the `retry_safety` object (update `lib/function-effects.ts`, the single source)
  - `plugin` provenance
  - untyped built-ins (`map`, `filter`) in completions with no input schema
- **Data console:** prefix change only; show the workflow revision header and the `connector` error class.
- **Operations dashboard:**
  - golden signals are unchanged (`/metrics`)
  - the attention feed adds quarantined entities, `engine_reload: degraded` and unconverged nodes
  - remove counts that came from status lists

**Phase 1 outcome (2026-11-16).** Done. The pending list fell from 71 to 66 calls (the rest are the CRUD modules phases 2–4 replace). Departures and findings:
- Traces, Audit, Trace DLQ and the Schedules ledger page by cursor with "Load more" (`useTraceList`, `useAuditLogList`, `useTraceDlqList`, `useCronOccurrenceList`). The traces table lost its sortable columns, because 2.0 has no server sort. Dashboard counts ask for `include_total`.
- Engine: the reload card is gone, and `RuntimeReport` covers edition, head/applied/desired revision, cluster store, quarantined members, `last_error`, drivers and provider backends. The connectors page's "Reload All" button went with the reload hooks.
- Audit vocabulary rewritten from the server's own audit calls. Change pins now pin nothing: a 2.0 change is one deployment row per revision, and pinning it needs Phase 2's revision diff (wired in Phase 6).
- Dashboard: a `deployment` incident fires for a revision the node cannot build and for quarantined workflow or connection members.
- Console: shows `X-Orion-Workflow-Revision` and a connector failure's class. Toasts and `ErrorState` show the connector line too.
- **Bug found and fixed:** the admin key was sent on data-plane requests by the client, by nginx injection and by the dev proxy. It now goes only to `/api/v2/admin/*`, `/metrics` and `/health`.
- Cron `since` / `until` are still zoneless in 2.0, so the trim stays. Audit `details` is still a JSON string.
- E2E: `e2e/seed.ts` deploys an echo workflow and channel through definitions → plan → apply (the CLI's flow), and `e2e/operate.spec.ts` checks the trace list's Load more, the Engine runtime card, the audit's 2.0 action and that the DLQ and Schedules pages load.
- Pages still on 1.x lists (DLQ's channel links, Schedules' channel picker, Operations' counts, the map) keep calling `/admin/channels` and similar, which 404 until Phase 3 replaces them with `useDeployedState`.

### Phase 2: Deployments, the new core (L)

New: `api/deployments.ts`, `api/definitions.ts`, `hooks/use-deployments.ts`, and the pages `deployments.tsx` and `deployment-detail.tsx`.

- **Single source: `useDeployedState(revision = head)`.**
  - `GET /deployments` gives the head; `GET /deployments/{rev}` gives the manifest; `GET /definitions/{digest}` is fetched lazily per member and cached forever, since content addressing makes it immutable (react-query `staleTime: Infinity`).
  - Returns members grouped by kind, the `requires` graph, rollouts, and per-entity load issues from `engine/status` and `node_status.quarantined_entities`.
  - **This replaces `useEntityIndex`** (the 1.x lists capped at 1000) as the single source for the system map, the palette, onboarding and the entity pages.
- **Deployments page:**
  - cursor list of revisions: revision, parent, member count, reason, `created_by`, `created_at`, a compacted marker
  - header shows `head_revision`, `applied_revision` (this node) and `epoch`
  - an "applied ≠ head" banner links to convergence
- **Revision detail:**
  - members table by kind, with links to the entity views
  - `requires` graph (reuse `components/graph`)
  - providers lock
  - raw manifest (`JsonEditor`, read-only)
  - compacted revisions say so and offer no member links
- **Revision diff:**
  - choose any two non-compacted revisions; diff is client-side by `(kind, id)`: added, removed, and changed (entity revision and digest)
  - drill into a changed member: fetch both definitions and reuse `VersionCompare` (the LCS diff; it ignores no fields now, because definitions carry no timestamps)
  - Plan shape: the same `added/updated/removed` structure as `DeploymentPlanResponse`, so Phase 5 renders server plans with the same component
- **Convergence panel:**
  - `GET /deployments/{rev}/convergence?target=this-node|observed`
  - converged, pending and degraded nodes; polls while not converged
  - shown on the revision page and after every apply or rollback
- **Rollback** (needs a mutating key):
  - Preflight: a diff from head to the target revision, the target's provider admissions as of now, and a required `reason` field.
  - Submit `{idempotency_key, base_revision: head, rollback_to, reason}` plus `X-Orion-Change-Context`.
  - The idempotency key is generated when the dialog opens and kept until success, so a retry after a network failure is safe.
  - Handle these errors:
    - 409 `DEPLOYMENT_HEAD_CONFLICT`: refetch, then show "head moved to N, review again".
    - 404 or 400 for a compacted target: disable the action in advance from the list data.
    - `local_error` and `warnings[]` on 202: show them inline.
  - Then open convergence.
- **Entity history across revisions.** `useEntityHistory(kind, id)` walks the deployment history (cursor pages, newest first, stopping at a configurable depth, default 50 revisions) and records each distinct `(revision, digest)` of the entity with the deployment revisions that carried it. History beyond compaction is shown as "older revisions compacted".

### Phase 3: Workflows, channels and plugins as deployed views (L)

Rework rather than rewrite: keep the detail and lens components and replace their data sources.

- **Lists:** members of the head by kind (no server paging needed, since the manifest is complete). Filters run client-side.
  - Status column → deployed revision + health (ok / load issue / quarantined).
  - "Archived" and "draft" no longer exist; remove them from `lib/status.ts` and `StatusBadge`. Status now means runtime health.
- **Workflow detail:**
  - The definition comes from its digest. `WorkflowDefinition` has no id or version; the entity id and revision come from the manifest.
  - The four lenses stay. The structure lens is unchanged. The deps lens becomes `requires` (connections, plugins) plus the catalogue. The cost and run lenses are unchanged (metrics, traces).
  - History and compare via `useEntityHistory`.
  - Channels serving it: the reverse of `requires`, plus rollout intervals.
  - **Test:** `POST /definitions/test` with the deployed definition, or with an edited copy in a scratch `JsonEditor` that is never saved. This needs a mutating key; read-only sessions see why it's disabled.
  - Remove: lifecycle actions, the rollout editor, the edit form, delete.
- **Channel detail:**
  - The definition no longer names a workflow. The workflow and rollout split come from the manifest's `requires`/`rollouts`. Show the split as a bar over buckets `[0,100)`.
  - Cron trigger stays. Response cache and auth config viewers stay; the config editors become read-only viewers. The neighbourhood map is fed from `useDeployedState`.
- **Plugin detail:** the manifest, signature presence, tags, the component's size and digest (never inline the base64), dependents via reverse `requires`, and catalogue entries whose `plugin` provenance points to it.
- **Retry safety** (`lib/retry-safety.ts`, `use-retry-safety.ts`) reads the head's workflow for a channel, not "the active version".
- **ID spaces:**
  - Entity ids (manifest `id`) are the one key for workflows, channels, plugins and connections.
  - Traces carry `channel` (name) and `channel_id`. Confirm against a live server which one equals the entity id, then update CLAUDE.md's "three ID spaces" section and `change-pins.ts` accordingly.
- **Delete:** `workflow-form`, `channel-form`, `plugin-form`, `lifecycle-actions`, `import-dialog`, `workflow-import-wizard`, `version-history` (replaced by entity history), `useActiveWorkflow`, all `*/status`, `*/versions`, `*/import`, `*/export` and `*/validate` API functions. Export becomes "download this revision's manifest + definitions" (a zip built client-side) on the revision page.

### Phase 4: Connections and provider packages (M)

- **Connections:**
  - `GET /connections` returns every revision of every connection. Group by `connection_id` client-side and page through it (the list is cursor-paged).
  - List: id, latest revision, deployed revision (from the head), provider (resolved from `provider_digest` against `/connector-packages` and `provider_backends`), last probe result (kept in memory for the session).
  - Detail:
    - revisions table
    - per revision: `public_config`, `secret_locators` (locator names only; values are never returned), `bindings`, `configuration_digest`
    - which deployment revisions used it
    - workflows that require it
    - circuit-breaker state for its key, with a reset action
  - **Probe** (mutating key): `POST …/{rev}/probes`, showing healthy, latency, driver, and `error_class`.
  - Delete the connectors pages and `connector-test-dialog`, and replace `ConnectorField`/`connector-config` editors with read-only viewers. If D1 = B, a "new revision" form reuses them (Phase 5).
- **Provider Packages:**
  - List: publisher, provider id, version, implementation (`rust|workflow|wasm`), tier, admitted, revoked, artifact state.
  - Detail: manifest, distribution, inventory, admission fingerprint.
  - Actions (mutating key, with confirmation):
    - **upload**: a folder or file picker that builds the `files` map, base64-encoding binaries, with `admit`/`lock` options
    - **admit**: `PUT …/admission`
    - **revoke**: `POST …/revocations` with a reason; warn when a deployed connection uses this digest
  - The tier badge versus `edition` says why a Standard package can't be admitted on Community.
- **Authoring tools** (S, optional for 2.0.0): a "Package studio" tab. Scaffold a provider package (`publisher, provider_id, kind, tier, version`), lint the files and show errors, pack it and show the digest. Read-only keys may use all three.

### Phase 5: Change sets: author and apply in the browser (L, only if D1 = B)

- **Draft:**
  - A change set starts from the head manifest (`base_revision = head`) and is held in `storage.ts` (`sessionStorage`) so a reload doesn't lose it.
  - It lists the edited members and shows a badge in the header while it's open.
- **Edit a member:**
  - Workflows: the workflow form returns, editing a copy of the definition; it uses the dataflow-ui 4 editor, lint and completions.
  - Channels: config, auth, cron, response cache and the `requires` workflow pick.
  - Plugins: upload the component and manifest.
  - Connections: a new revision form over `provider_digest`, with `public_config` from the provider manifest's schema, plus `secret_locators` and `bindings`.
  - On save:
    - upload the definition (`POST /definitions`), which is idempotent because it's content-addressed
    - show `advisories` inline
    - assign the member revision as the CLI does: reuse it if this digest already appears for the entity in history, otherwise use max + 1
- **Add or remove members.** Removing is explicit ("stops serving"). Every `requires` reference is checked client-side before planning.
- **Rollout editor** (Standard+): intervals that partition `[0,100)`. Every workflow revision named must also be in `requires`. On Community it's disabled, with the `TIER_NOT_ENABLED` reason shown.
- **Plan:** `POST /deployment-plans` shows the server's added/updated/removed list in the Phase 2 diff component and records `reviewed_manifest_digest`. Read-only keys can plan, which is useful for review.
- **Apply:**
  - `POST /deployments` with `{idempotency_key, base_revision, manifest, reason, reviewed_manifest_digest}` plus the change context.
  - On 409 head conflict: "rebase" re-plans the same edits against the new head and shows the new diff.
  - On 400 `DEPLOYMENT_WOULD_NOT_BUILD`: show the error details against the right member.
  - Then convergence, then clear the draft.
- **Import:** accept a compiled deployment directory (the `orion-cli compile` output) as a folder upload, giving a change set that you plan and apply. This lets a team that uses the CLI hand a release to an operator who only has the UI.

### Phase 6: Cross-cutting rework (M)

- **System map:**
  - `lib/topology.ts`, `system-graph.ts`, `dependency-graph.ts` build from `useDeployedState` (the members plus the `requires` edges) rather than from `channel.workflow_id` and 1.x lists.
  - Rollout edges show the bucket split.
  - The "lifecycle" colour mode in `traffic-encoding.ts` becomes "health" (ok / load issue / quarantined).
- `lib/change-pins.ts`: audit rows → deployment revisions → changed members.
- `lib/onboarding.ts`: counts from the head manifest. The first-run steps point to `orion-cli deployments apply` (or the change set, if D1 = B).
- Command palette, `nav.ts` and `g`+key shortcuts follow the new IA. Old routes redirect (see above).
- Read-only mode: every mutating verb goes through `useCanMutate()`. Read-only sessions see the reason, never a button that fails (PRODUCT.md: "never show a verb the server won't honour").
- Edition gating: everything Standard+ goes through `useFeature()` and is rendered as a neutral fact on Community.

### Phase 7: Tests, docs and release (M)

- **Unit tests:**
  - port or replace the tests for the deleted modules
  - new tests: deployment diff, entity history (including compacted gaps), connection grouping, cursor list, envelope choice per endpoint, auth state machine, rollout interval validation (Phase 5), and the `dataflow-4` replay tests
- **Contract test:** `INVOCATIONS` covers every exported API function (the completeness check passes).
- **E2E** (`e2e/smoke.spec.ts` rewritten):
  - Seed by running `orion-cli deployments apply -d` with an example package from `Orion/examples` (pinned CLI rev `6682d04`).
  - The UI then checks:
    - head revision and members
    - workflow detail and lenses
    - test a definition
    - send through the console and see the trace
    - cron trigger and occurrence
    - connection probe
    - apply a second revision via the CLI, diff the two in the UI, roll back in the UI, wait for convergence
    - audit shows apply and rollback
    - backups
    - DLQ and provider-package empty states
    - read-only key: verbs hidden, plan allowed
    - (Phase 5) author a change and apply it
  - A separate optional job against `orion-ext` (the private image needs registry credentials) covers rollouts and ext providers. Run it on `workflow_dispatch` until the credentials are set.
- **Docs:**
  - README (supported server: Orion 2.0; auth setup — `ORION_ADMIN_AUTHORIZATION` for nginx is already documented)
  - CLAUDE.md (the 2.0 contract, envelopes, single sources: `useDeployedState`, `useRuntimeCapabilities`, `useCanMutate`, `useEntityHistory`, the ID spaces)
  - PRODUCT.md (deployment model wording)
  - DESIGN.md if new components are added
- **Release:**
  - version `2.0.0`
  - CHANGELOG `[2.0.0]` with the removed surfaces listed
  - CI pins `orion:2.0.0`
  - check `docker-release.yml` and the nginx template (pass `Authorization` through; optional key injection per D2)
  - tag after Orion `v2.0.0` is published

## What gets deleted

- Pages: `models*`, `packages`, `connectors*`, `*-form` (except in Phase 5), `channel-form`, `workflow-form`, `plugin-form`.
- API modules: `models.ts`, `packages.ts`, `connectors.ts` (replaced by `connections.ts` and `connector-packages.ts`). `workflows.ts`, `channels.ts` and `plugins.ts` shrink to the trigger call plus deployed-view helpers.
- Components and libs: `lifecycle-actions`, `import-dialog`, `workflow-import-wizard`, `version-history`, `connector-test-dialog`, `model-manifest`, `use-entity-index` (replaced by `useDeployedState`), the `EntityStatus` lifecycle in `types.ts` and `status.ts`, the rollout editor in `workflow-detail`, and `workflow-mapper`'s 3.x back-translation.

## Risks and open points

1. **No definition list and no per-entity endpoints.** Every entity view depends on the head manifest plus per-digest fetches. A large deployment (hundreds of members) needs lazy definition fetches and virtualised tables. Measure with an example package plus a synthetic manifest of about 500 members.
2. **Compaction.** Compacted revisions have no members, so entity history and diffs have gaps. The UI must say "compacted", never imply "unchanged".
3. **`GET /connections` returns every revision.** Grouping client-side means paging through all of them. This is fine for tens of connections. If it becomes slow, ask for a `latest_only` parameter in Orion 2.1.
4. **ID spaces** (Phase 3): confirm on a live server how trace `channel`/`channel_id` relate to manifest entity ids before changing `change-pins` and `trace → entity` links.
5. **Docs bug found during research:**
   - `Orion-docs/src/enterprise/traffic-splitting.md` writes rollout intervals as `start`/`end` and uses an `X-Admin-Key` header.
   - The wire format is `start_bucket`/`end_bucket` with `deny_unknown_fields`, and the default header is `Authorization: Bearer`.
   - Fix it in Orion-docs before tagging, independently of the UI.
6. **E2E before the Orion tag:** no published 2.0 image exists until `v2.0.0` is tagged. CI builds the server from source (slow on a cold cache, about 30 minutes, the same as Ext's HA drill) until then.
7. **Ext coverage:** rollouts and provider packages at Standard tier can only be exercised against `orion-ext`, a private image. CI needs read access to `ghcr.io/goplasmatic/orion-ext`.
8. **Read-only keys cannot call `definitions/test` or probes.** That's by design on the server; the UI explains it rather than hiding the page.

## Suggested order and rough size

| Order | Phase | Size | Can start |
|---|---|---|---|
| 1 | 0 Foundations | M | now |
| 2 | 1 Surviving surfaces | M | after 0 |
| 2 | 2 Deployments | L | after 0 |
| 2 | 4 Connections + provider packages | M | after 0 |
| 3 | 3 Deployed entity views | L | after 2 |
| 4 | 6 Cross-cutting | M | after 3 |
| 5 | 5 Change sets (D1 = B only) | L | after 2 and 3 |
| 6 | 7 Tests, docs, release | M | runs alongside; closes last |

D1 = A: roughly 6–8 engineer-weeks. D1 = B: add 2–3 more.
