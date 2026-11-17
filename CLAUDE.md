# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (proxies /api, /health, /healthz, /readyz, /metrics to ORION_URL)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run preview      # Preview production build locally

npm test             # Vitest unit tests, incl. the API ↔ OpenAPI contract test
npm run test:e2e     # Playwright against a live orion-server 2.0 on :8080 (skips locally if absent).
                     # ORION_URL points it at another server; UI_PORT moves the dev server off 5173 —
                     # `reuseExistingServer` adopts whatever is already listening there.
                     # ORION_ADMIN_KEY / ORION_READ_ONLY_KEY: the keys that server was started with.
npm run generate:api # Regenerate src/api/schema.d.ts from contracts/openapi.json
npm run check:contract # Fail if schema.d.ts is stale relative to the vendored spec
```

Two version pins in `package.json` are deliberate. `typescript` is held at `~5.9`: 7.x is the
native compiler and ships no JS compiler API (`lib/typescript.js`), which `typescript-eslint`
and `openapi-typescript` both need — their peer ranges (`<6.1` and `^5`) refuse 6.x/7.x, so an
install with either fails. `@xyflow/react` is pinned *exactly* to the version
`@goplasmatic/dataflow-ui` pins exactly; see Visualization Libraries.

The `overrides` block is deliberate too. Both entries force a *patch* bump inside the same minor
line on a transitive dependency its parent pins to an exact version — which is why `npm audit fix`
is a no-op on them and an override is the only lever. `monaco-editor` (via
`@monaco-editor/react` <- `@goplasmatic/dataflow-ui`) pins `dompurify` below `3.4.16`, which is
vulnerable through `3.4.15` (override moved to `3.4.16` on 2026-10-02); `@redocly/openapi-core` (via `openapi-typescript`) pins `js-yaml` at `4.3.1`,
vulnerable through that version. Each override is scoped to the pinning parent rather than
declared globally, so nothing else in the tree is forced onto a version it did not ask for. Drop
an entry once its parent ships a release that depends on the patched version itself.

## Server contract

**The port to Orion 2.0 is under way — see `PLAN-2.0.md`.** The API layer speaks `/api/v2`; the
pages still built on 1.12's per-entity CRUD are ported phase by phase.

`contracts/openapi.json` is the vendored copy of the server's OpenAPI 3.1 spec and pins the
server version this UI targets (now 2.0.0). Orion 2.0 no longer keeps a `docs/openapi.json`: the
spec is generated into Orion-docs (`cargo run --manifest-path drift/Cargo.toml --bin
dump-openapi > openapi.json` there), and a running server serves it at `/api/v2/openapi.json`
— **only when it does not run with `environment = "production"`**.
`src/api/schema.d.ts` is generated from it (do not hand-edit).

`schema.d.ts` is **not imported anywhere**: it exists solely as a checked-in fingerprint for
`npm run check:contract`. Every type the app uses is hand-written in `src/api/types.ts`, so
regenerating it buys no type safety — read it to transcribe new shapes accurately, then write
them into `types.ts` by hand.

When the server API changes:

```bash
cp ../Orion-docs/openapi.json contracts/openapi.json
npm run generate:api
npm test
```

The 2.0 spec resolves as published, so the 1.x local patch (`contracts/patch-spec.mjs`, which
added the unregistered `OnConflict` / `ReloadMode` schemas) is gone.

`src/api/contract.test.ts` asserts every request the API layer can issue exists in the spec with
the same method and only declared query params, and its completeness check forces new API
functions to be added to the `INVOCATIONS` manifest. Note it matches spec paths **structurally**
(segment count plus `{param}` wildcards), so a path that moved to a same-shaped route fails as a
*method* mismatch rather than a path one. It also holds each function to its endpoint's
**envelope**: a `Data_*` answer must be unwrapped, a bare or `Page_*` one must not. Calls still
speaking 1.12 are listed in `PENDING_V2`, and each is held to *still failing* — porting one
without removing it fails the test, so the list only shrinks. CI runs both plus the Playwright
suite against a real server (built from the pinned Orion commit until `orion:2.0.0` is published).

## Architecture

Orion UI is a React 19 dashboard for the Orion workflow engine. It uses Vite 8, TypeScript (strict), Tailwind CSS v4, and TanStack Query/Table.

### Core Domain

Being ported from the Orion **v1.12.0** API to **2.0** (dataflow-rs 4 / datalogic-rs 5.9;
`PLAN-2.0.md`). In 2.0 a node serves exactly its deployed manifest: workflows, channels and
plugins are **members** of it — immutable, content-addressed definitions bound to an id and a
revision — and change only by applying a deployment (`orion-cli deployments apply`; the UI
operates and does not author, D1 = A). Their pages are read-only views of the head
(`hooks/use-registry.ts`, below). Connections are revisions over providers (below); 1.x's
connectors, models and package receipts are gone.

- **Channels** — Service endpoints (sync/async, REST/HTTP/**cron**, plus whatever protocol an
  edition's driver adds — `ChannelProtocol` is open). Config covers `auth`
  (`api_key` | `hmac` | `jwt`), rate limits (incl. `key_logic` + `key_headers`), backpressure,
  dedup, caching (incl. `key_logic` since 1.5), `origin_allow_list`, `request`, `response`
  (incl. `cookies`), `validation_logic`, `tracing` and **`oauth2_login`** (1.6, inbound OAuth2 /
  OIDC sign-in), all rendered read-only on the channel page. The workflow a channel runs is the
  one its member `requires` (the definition names none), and a Standard+ canary splits its 100
  buckets across workflow revisions (`rollouts`, drawn by `RolloutBar`). `methods` is
  `string[] | null`. A **cron
  channel** (`protocol: "cron"`, 1.6) is started by a clock: its schedule lives in
  `transport_config`, it is always `async`, registers no route or topic, is refused everything
  caller-shaped in `config` (`lib/cron.ts::CRON_REFUSED_CONFIG_KEYS`), and is run manually with
  `POST admin/channels/{id}/trigger` — never from the Data Console.
- **Schedules** — The cron occurrence ledger (`/schedules`): `GET admin/cron/status` (one row
  per active cron channel — schedule, next fire, last run, backlog) and
  `GET admin/cron/occurrences` (every instant a schedule was due, with `retry` for a failed or
  skipped one). An occurrence detail page carries the trace id, the executing version and the
  lease. Also embedded on a cron channel's detail page.
- **Plugins** — Custom task functions as sandboxed WebAssembly components (`/plugins`): a
  member whose definition carries its `plugin.toml` manifest and the component as base64. The
  console never keeps the bytes: `useDefinition` replaces them with their size and `sha256:`
  digest (`withoutComponentBytes`), which is what `/health`'s plugin loads and the catalogue name
  it by. Dependants are the members whose `requires` names it.
- **Workflows** — Step pipelines with JSONLogic conditions. A step is a **task** (carries
  `function`) or, since 1.2, a **task group** (carries its own `tasks`) — one condition gating a
  contiguous run, plus `terminal` to end the workflow after a step. **A workflow may be deployed
  at several revisions at once** (a canary): the registry keeps every one and names a primary
  (`?revision=` picks another on its page). Four **lenses** over the diagram — Structure (the
  visualizer), Dependencies (the steps plus the member's `requires`, the compiler's own walk),
  Cost (per-task share of a run from metrics) and Last run (a trace's steps overlaid). **Test**
  runs the deployed definition — or an edited copy that is never saved — through `POST
  admin/definitions/test` (live backends, so a read-only key is refused). Uses
  `@goplasmatic/dataflow-ui` `WorkflowVisualizer` and `@goplasmatic/datalogic-ui` `DataLogicEditor`.
- **Connections** (`/connections`, 2.0) — what 1.x called connectors: a backend a workflow or
  channel calls, as immutable numbered revisions over a **provider** — a built-in Rust driver
  (`runtime-capabilities.provider_backends[].package_digest`) or an admitted provider package —
  named only by `provider_digest` (`lib/connections.ts::resolveProvider` names it). A revision
  carries `public_config`, `secret_locators` (config path → `env://` / `vault://`; the values are
  never returned) and `bindings`, and a deployment member names it by `configuration_digest`.
  `GET admin/connections` lists **every revision of every connection** (no "latest only"), so
  `useConnections` reads it to the end once (`fetchAllPages`, capped) and groups it by id with the
  revision the head deploys. A task's `connector` input, a channel's cache/dedup `connector`, a
  breaker key and `/health`'s failed loads all name a connection **by id**, so a link is
  `/connections/{id}` with no lookup. **Probe** (`POST …/revisions/{rev}/probes`) dials the real
  backend with the real credentials: 200 whatever it found (`healthy`, `latency_ms`, `driver_id`,
  `details.{probe, error, error_class, effect_status}`), audited, refused to a read-only key. The
  server stores no probe, so the console keeps the last one per revision for the session
  (`probeKey`). The UI does not create revisions (D1 = A): `orion-cli` does.
- **Functions** — The server's function catalogue (`GET admin/functions`, `api/functions.ts`,
  `use-functions.ts`) is fetched but has **no page**: the `/functions` reference was removed on
  2026-09-05 because a standalone list answered no question anyone had while doing something
  else. The catalogue surfaces where the question is asked: completion inside the workflow
  editor, and the retry-safety guard on the DLQ requeue and occurrence retry dialogs. Its shape
  still matters: since 1.2 it is *every*
  valid function name, not just the schema registry — entries carry `source` (`orion` | `engine`
  | `plugin`), `input_fields` is **absent** for an engine built-in, every
  entry carries `retry_safety` (1.6) and a `plugin` entry names the plugin version and digest
  serving it.
- **Provider packages** (`/provider-packages`, 2.0) — a connector provider shipped as files (a
  `workflow` composite or a `wasm` component; `rust` packages describe a composed driver): stored
  by digest (`POST admin/connector-packages`, files as UTF-8 text or `base64:`), admitted under the
  node's policy (`PUT …/admission`, optionally against a provider lock), revoked for good (`POST
  …/revocations`, warned when a deployed connection uses it). A package's `tier` above the node's
  `edition` can be stored but not admitted (`TierBadge`). The **Studio** tab runs the authoring
  tools — scaffold, lint, pack — which store nothing (`lib/package-files.ts` turns a picked folder
  into the `files` map). Models are no longer an entity: in 2.0 a model is a provider behind a
  connection (`com.orion.models`, an edition's).
- **Trace DLQ** — Operator view of the async dead-letter queue (`/trace-dlq`): inspect, requeue,
  purge.
- **Health** — `/engine` (named Settings until 2026-09-05; `/settings` redirects) renders the
  whole `/health` report (`health-components.tsx`): every
  component with what its state means, plus the admin-only detail — background tasks, plugin
  loads and failures, the scheduler's own numbers, and since 1.9 the `[packages] apply` progress.
  It also carries the **running generation** from `GET admin/engine/status`: its id, this node's
  capabilities, and what that generation could not load. The Operations dashboard shows only the
  faults.

### v1.x wire contracts worth remembering

- **1.10–1.12 additions.** `POST admin/cron/occurrences/{id}/cancel` settles a `pending` |
  `claimed` | `running` occurrence as failed (409 once finished; `lib/cron.ts::isCancellable`).
  `POST admin/cache/namespaces/{ns}/invalidate` answers `{namespace, stores}`; a channel names
  its namespaces in `cache.namespaces` (1–8, `a-z0-9_-.:`) and may set `cache.coalesce_misses`.
  There is **no namespace listing** — `lib/cache-namespaces.ts` reads them off the channel
  registry. `oauth2_login` (1.11) is the flat form *or* `providers` keyed by slug (routes and
  `redirect_uri` then carry `{provider}`), with `issuer` (OIDC discovery), `kind`,
  `userinfo_url`, `identity` and `providers_from_instance`; the channel page shows it read-only.
  Audit gained `cancel` / `invalidate` / `cache_namespace` (`lib/audit-vocabulary.ts`).
- **A workflow's steps are `loop.setup` then `tasks` (1.10).** Every server walk covers the
  loop's setup; `workflowSteps(workflow)` is the client's. A task may carry `for_each`. Counting
  or reference-walking `workflow.tasks` alone misses whatever the setup reads.
- **Trace steps (dataflow-rs 4 on Orion 2; 3.15 on 1.12).** Orion 2 stores `task_trace_json`
  as dataflow-rs 4's replayable trace: `{initial, steps, truncated}`, each step with `task_id`,
  `result` (`executed` | `skipped` | `failed`), `status`, its `changes` (`removed` / `replaced`
  flags), `mapping_ends`, `errors`, `elapsed_us`, `loop_counter`, `element_index`, and no
  snapshot. `lib/trace-timeline.ts::executionTrace` is the one parse point: it replays the
  changes from `initial` into a per-step `message` snapshot and `mapping_contexts`, maps
  `elapsed_us` → `duration_us`, and drops the engine's own steps (no `task_id`, the loop
  counter) after applying them — so everything downstream reads one step model. A v4 step has
  **no start instant**: `buildTimeline` lays the steps end to end, so admission and the gaps
  between steps are not measured; a `failed` step is the failure. 1.12 (dataflow-rs 3.15) is
  still read: each executed step carries the snapshot itself, `started_at` (RFC 3339, ns, `Z`),
  `duration_us`, `changes`, `loop_counter`, `element_index`; the trace may be `truncated`
  (snapshots dropped, timings kept). There `result` is only `executed` | `skipped` — **a step
  that errored is `executed`**; the failure is named in the trace's error prose
  (`lib/trace-error.ts::parseEngineError`). Observed quirks the timeline absorbs: a **sync**
  trace row is stamped at persist time (`started_at == completed_at`, after the steps,
  `duration_ms` ≈ 0), so the steps' span wins; a failure the engine reports as an IO error can
  keep **no** steps; a sync request that times out or fails with a 5xx persists **no trace at
  all**. With `errors_only`, a successful run keeps nothing.
- **Function effects come from the catalogue.** `lib/function-effects.ts::stepEffect` reads
  `category: "connector"`, `source: "plugin"` + `plugin`, and `retry_safety`, resolving
  `depends_on` from a literal input (`http_call` method, `data_write`/`mongo_write` op,
  `db_write` sql). It is the one answer to "what does this step touch" and "does a retry repeat
  it" — the trace timeline, the workflow lenses, the map and the retry guard all use it.

- **A reload's 200 is not proof that anything is serving (1.9).** A reload never fails because
  one entity did not load: the entity is quarantined and everything else serves. `POST
  admin/engine/reload` and `GET admin/engine/status` both answer with `generation` and
  `load_issues` — `{channels, connectors, plugins, models}`, built by *one* collector on the
  server, which is why `/health`'s four admin-only lists have the same shape. **`load_issues`
  absent is the skew signal**: a pre-1.9 server cannot tell you, which is not the same as nothing
  being quarantined — `countLoadIssues`/`noLoadIssues` in `types.ts` keep the two apart.
  `shared/load-issues.tsx` is the one renderer; `HealthComponents` takes the engine's copy as a
  prop and falls back to `/health`'s. Prefer the engine's: `/health`'s detail is served only to a
  caller the server recognises as an admin, so on an instance with `admin_auth` on it can be
  missing there and present on the admin plane. Both answers describe **the node that answered** —
  a peer reloading on the same epoch bump may refuse differently.
- **`engine/status.capabilities` (1.9)** is `{cron, plugins, models}` — the three runtimes that are
  off by default. A cron channel on a node with `cron.enabled = false` is not a broken channel; it
  is a schedule that would never fire, and the node quarantines it saying so. Reading the
  capability is how that is knowable *before* a reload discovers it, which is why `off` renders
  neutral rather than as a fault.
- **`/health`'s `connectors.failed_to_load` is a list of objects, not names.** `{connector,
  connector_id, stage, reason}` — `stage` is `env_substitution`, `json_parse`, `var_reference`,
  `secret_resolution`, `deserialize` or `endpoint` (the last two are 1.9). Reading it as `string[]`
  renders `[object Object]` and matches no connector, which is what `lib/faults.ts` and
  `use-attention.ts` used to do. `channels.quarantined` likewise gained `channel_id` and
  `workflow_id` in 1.9, so a quarantine links straight to its channel without the channel list.
- **`concurrency.slots` (1.9)** on a cron channel: `forbid` admits up to N runs of a key at once
  (1–64, default 1) where it admitted exactly one. **`forbid` only** — sending it with `allow` is a
  400, not a no-op, so a policy switch must drop it. A run takes the lowest free slot, holds it for
  the whole attempt and reads it as `metadata.trigger.singleton_slot`; one channel with four slots
  replaces four cloned "lane" channels. The scope is the *database*: per node on SQLite, shared
  across the cluster on PostgreSQL/MySQL. `GET admin/cron/status` gained `concurrency_policy`,
  `singleton_key`, `slots` and `slots_held` — and **`slots_held` counts leases across every channel
  sharing the key**, so it can exceed this channel's own bound when a peer declares more or `slots`
  was just lowered. `lib/cron.ts::concurrencySlots`/`slotUsage`/`lintSlots` are the readers.
  **Every node must be on 1.9 before a channel setting it is activated** — an older one refuses the
  unknown key and quarantines the channel.
- **`auth.scheme` is a scheme *name*, not a byte prefix (1.8.2).** The header is parsed as RFC 9110
  §11.1 defines it: scheme, one or more spaces, credential. The scheme matches case-insensitively,
  so `"Bearer"` and the old spelling `"Bearer "` are the same scheme and `Bearer<key>` with no
  space is refused. An empty value means no scheme — the bare credential. A value that is not an
  RFC 9110 token, like `"Key="`, is a **400** at create, update, validate and import, and
  quarantines a channel already stored with one. The same applies to `jwt`'s `source.scheme`.
- **`model_infer`** takes `model` (a literal id or JSONLogic routing per message), `input`,
  `output` (default `temp_data.inference`), `raw`, `runtime`, `timeout_ms` (JSONLogic since
  1.8.1, like `channel_call`'s and `http_call`'s — a computed value can only *lower* the host
  cap) and `stats_output` (`{id, version, digest, runtime, device, parameters, artifact_bytes,
  ops, peak_ops, queued_ms, inference_ms, cold_load}`; `ops`/`peak_ops` are 1.8.1 — what the
  manifest's expressions charged, `peak_ops` being the number `engine.ops_budget` is compared
  against). A workflow naming a model the set does not serve by *literal* id is **quarantined**;
  a computed one is answered per message and fails as `unavailable`.
- **The JSONLogic tensor family (1.8) is a live-operator hazard.** Seven of its twenty names —
  `shape`, `full`, `cast`, `pad`, `crop`, `concat`, `stack` — are ordinary JSON keys, and in a
  template position a single-key object whose key is a live operator is a *call*, not data. A
  stored mapping emitting `{"shape": [6, 7]}` changed meaning in 1.8; the fix is the `$` escape
  (`{"$shape": [6, 7]}`). In 2.0 the server reports it on upload as a definition advisory
  (`logic.escaped_template_key`); `template_at` must still never be hardcoded.

- **A cron channel's schedule is `transport_config` (1.6).** `{ schedule, timezone?, payload?,
  misfire_policy?, max_catch_up?, concurrency? }` — six-field expression (seconds first; five- and
  seven-field forms are refused rather than guessed at), an IANA zone, a fixed payload delivered
  where a request body would be. `lib/cron.ts::cronTransport` is the one reader. Unknown keys are
  refused. `payload` is recorded verbatim as every occurrence's trace input, so secrets and
  `env://`-style references are refused in it. `metadata.trigger` is what the workflow gets:
  `type` (`cron` | `manual`), `occurrence_id`, `scheduled_for`, `started_at`, `attempt`,
  `singleton_key` and `singleton_slot` (1.9).
- **Occurrences outlive names.** `admin/cron/occurrences?channel_id=` filters by the stable id —
  an occurrence keeps the channel *name* it was materialised under, so renaming does not rewrite
  history. Statuses (`pending`, `claimed`, `running`, `completed`, `failed`, `skipped_misfire`,
  `skipped_singleton`) are an open string. A misfire run is **one** row with the count and range
  in `error_message`, not one per missed instant. A retry keeps the id and `scheduled_for` and
  increments `attempt`; only `failed` / `skipped_*` accept it (409 otherwise). An occurrence
  records `singleton_slot` beside `singleton_key` (1.9): two runs of one key can share a
  `fencing_token` when they hold different slots, so it is the **pair** that names a hold.
  Re-running finished work is a *trigger*, which mints a new occurrence. Failed occurrences never enter the trace DLQ.
  Cron runs **do** count in `orion_messages_total{channel}`, unlike `channel_call` targets.
- **`/health` components (1.4–1.8):** always `database`, `engine` (constant ok), `connectors`,
  `channels`, `background_tasks`, `engine_reload` (the last reload failed — serving the previous
  generation), `plugins` and `models` (each `disabled` when that runtime is off and nothing needs
  it; a *state*, not a fault — `lib/status.ts::isComponentFault` keeps both off the dashboard;
  `models` degrades when the generation could not carry an active model, which quarantines the
  workflows naming it, or when the admission worker is down); conditionally
  `kafka`, `cron` (on, or off while an active cron channel is quarantined), `config_propagation`,
  `cluster_redis` and `packages` (1.9, only under `[packages] apply`). `degraded` on `engine_reload`/`config_propagation`/`cron` does not fail
  `/readyz`. Admin-only detail adds `plugins.{loaded,failed_to_load}` (a failed load quarantines
  every workflow naming the plugin's functions — surfaced as an alert like a failed connector),
  `cron` (reconcile age, oldest pending, lease renewal failures) and `background_tasks[]`.
- **Plugins are off by default** (`plugins.enabled = false`): every `admin/plugins` route answers
  400, and a stored active plugin row quarantines its dependants rather than aborting. A plugin
  function is pure JSON → JSON with no imports at all (no clock, sockets, connectors, secrets — a
  `{"secret": …}` node in a plugin task's input is a create-time error). Activating a version is
  checked against every active workflow calling it: a renamed or newly-required field is a 409
  naming the workflow. `GET admin/workflows/{id}/dependencies` gained `plugins[]` (id, version,
  digest, functions) and `unresolved_functions[]` — a workflow with any of the latter would be
  refused activation on this node. `PluginResponse.manifest` is the validated manifest as JSON;
  `functions` repeats the names at the top level so a client need not walk it.
- **`retry_safety` (1.6)** is served for every catalogue entry as `{"kind"}` — `pure`, `read`,
  `idempotent_write`, `unsafe_write`, or `depends_on` with the `input` that decides
  (`http_call` → `method`, `data_write` → `op`). A different question from whether an *error*
  was transient. `retry-safety-badge.tsx` renders it.
- **`template_at` (1.5)** on a catalogue field: `[""]` means the value is JSONLogic, compiled
  once and evaluated per message, so an object there may be an operator call rather than a
  literal of the declared kind. A literal is JSONLogic for itself, so the static spelling still
  works. `channel_call.channel` is one such field — a computed target is an object, and
  `lib/topology.ts::channelCallTargets` skips it (the server's `has_dynamic_channel_calls` is the
  authority; `channel_logic` is no longer read).
- **`on_rejection` / `on_failure` (dataflow-rs 4)** on a task: `on_rejection: "halt"` ends the
  workflow on a 4xx (which covers a `validation` rule), `on_failure` is `fail` | `continue` |
  `halt` for a handler error or 5xx — the outcome axis to `terminal`'s position axis; they
  compose by `or`. The server refuses the 1.x `halt_on` / task `continue_on_error`, and
  `lintSteps` names the v4 key to write. `haltsOnOutcome` / `countHaltOnFailure` badge it, and
  the visualizer (dataflow-ui 4) draws them as written.
- **`?token=` on trace reads is deprecated (1.6).** The header `x-trace-token` is what
  `tracesApi.get` has always sent; the console now hands the token to the trace page in router
  *state* rather than the UI's own URL, for the same reason (browser history, `Referer`, pasted
  links). `/traces/:id?token=` is still read for old links.
- **Trace `mode` is open:** `sync` | `async` | `cron` in 2.0 (`TRACE_MODES` drives the filter);
  an edition's driver may add its own, and the filter keeps an unlisted value visible.
- **Audit vocabulary (2.0)** — `lib/audit-vocabulary.ts`, read from the server's own
  `audit_record` calls: `v2_deployment_apply` / `v2_deployment_rollback` (`resource_type:
  deployment`, the id is the committed revision — the only *change* actions, so the map's
  change pins wait for phase 6 to read a revision's diff), `v2_definition_upload` / `_test`
  (`definition`), `v2_connection_create` / `_probe` (`connection`), `v2_package_upload` /
  `_admit` / `_revoke` (`connector_package`), plus `trigger` (channel), `retry` / `cancel`
  (`cron_occurrence`), `invalidate` (`cache_namespace`), `reset` (`circuit_breaker`), `requeue` /
  `purge` (`trace_dlq`) and `create` (`backup`). 1.x's lifecycle actions (`status_active`,
  `update_rollout`, `create_version`, `reload`, …) are gone; a 2.0 server starts on a fresh
  database. A new action or resource type goes in the vocabulary *and* `lib/audit-routes.ts`, or
  rows arrive unfilterable; both are open strings on the wire, so the dropdowns keep an unlisted
  value from the URL visible (`UnknownOption`).
- **Deployments (2.0; phase 2).** `api/deployments.ts`, `hooks/use-deployments.ts`,
  `lib/deployment-diff.ts`, `components/deployments/`, `/deployments` and `/deployments/:revision`
  (`?tab=members|changes|convergence|manifest`, `?compare=<revision>`). A node serves one
  manifest at a time; history is append-only, and a rollback commits an older manifest again as
  the next revision (`base_revision` is a compare-and-swap: 409 `DEPLOYMENT_HEAD_CONFLICT` when
  the head moved). The rollback dialog mints its idempotency key once, so a retry replays. Every
  deployment answer is **bare**. `useDeployedState()` (the head's manifest) is the single source
  for "what serves now" — 2.0 cannot list entities, so the entity pages, the map and the palette
  read it (phases 3 and 6). A member is keyed by `(kind, id)`; its `revision` is the author's
  numbering and `definition_digest` what it is — the diff compares both, plus `requires` and
  `rollouts`. **A connection member's digest is a configuration digest, not a definition**:
  `GET admin/definitions/{digest}` is for workflow, channel and plugin members only
  (`hasDefinition`). Definitions are content-addressed, so `useDefinition` caches them forever.
  A compacted revision keeps its row but loses its members: say "compacted", never "empty".
  `entityHistory` reads an entity's states across revisions for phase 3.
- **No reload in 2.0.** `admin/engine/reload` is gone: applying a deployment rebuilds the engine,
  and each node converges on the head by itself. The Engine page reads where this node stands
  from `runtime-capabilities.node_status` (`components/admin/runtime-report.tsx`), and a revision
  the node cannot build, or a quarantined workflow or connection member, is a `deployment`
  incident on the dashboard (`lib/incidents.ts::nodeIncidents`).
- **The admin key never goes to the data plane** (`api/auth.ts::mayCarryAdminKey`; also the
  nginx template's `/api/v2/data/` block and the dev proxy). A channel is called the way its own
  callers call it — the admin key would leak to it and stand in for, or clash with, the channel's
  own `Authorization` check. The console shows `X-Orion-Workflow-Revision` (the revision a
  canary split routed to) through `RequestOptions.onHeaders`, and a connector failure's class and
  provider code through `lib/toast-error.tsx::connectorLine`, as `ErrorState` and toasts do.
- **`response.cookies` (1.5)** is its own switch — a shaped channel's workflow may then set
  cookies declaratively through `data._orion.response.cookies`. A response that sets a cookie is
  never stored in the response cache. `cache.key_logic` is the general form of
  `cache_key_fields` and takes precedence.
- **Integrity failures (1.5):** `errors[].code` may be `integrity_unique` / `integrity_foreign_key`
  (a run that does not catch one answers 409) or `integrity_not_null` / `integrity_check` (400).
- **`orion_messages_total{status}` counts a run that finished with task errors as `error` on every
  transport since 1.4** (the sync route used to count it `ok`).
- **Envelope (2.0):** the admin surfaces carried over from 1.x answer `{ data: T }` (`Data_*` in
  the spec; `unwrap()` in `client.ts`). Lists answer a `Page_*` — `{ data, limit, next_cursor?,
  total? }` (`Page<T>` in `types.ts`), cursor-only, newest first, with `offset`, `sort_by` and
  `sort_order` gone; `total` only with `include_total=true`. The resources new in 2.0
  (definitions, deployments, plans, connections, connector packages, runtime capabilities)
  answer **bare**, with no envelope. `/health`, `/healthz` and `/readyz` are not admin routes and
  are not wrapped; in 2.0 `/healthz` (`LivenessResponse`) and `/readyz` (`ReadinessResponse`, read
  even on its 503) have their own shapes.
- **Admin auth (2.0; `api/auth.ts`).** `/api/v2/admin/*` and `/metrics` take `Authorization:
  Bearer <key>` (or the raw key in a configured `admin_auth.header`); production requires it. A
  read-only key may `GET`, plan and use the authoring dry-runs, and is refused everything else
  with 403 `FORBIDDEN`. **A request with no key is a failed attempt**, and five lock the address
  out for up to 30 s — during which a *correct* key is also answered 401. So no guarded request
  leaves the browser before one probe (`GET admin/runtime-capabilities`) has answered, and after
  a 401 they fail locally (`ApiError.heldBack`) until a key is entered. The key lives in
  `sessionStorage` (`orion-admin-key`, through `storage.ts`); the header name in `localStorage`. A
  401 naming a header (`Missing X-API-Key header`) is how a custom header is learned. Read-only is
  learned from the first refused mutation (`useCanMutate`); full access from the first accepted
  one. Queries never retry a 401/403 (`isAuthError`), because a retried 401 counts toward the
  lockout. The image's nginx (and the dev proxy) can add `ORION_ADMIN_AUTHORIZATION` to requests
  that carry none.
- **Runtime capabilities (2.0)** — `GET admin/runtime-capabilities` (`useRuntimeCapabilities`):
  `api_version`, `edition` (`community` < `standard` < `enterprise`), channel drivers, provider
  backends, the deployment head and this node's reconciler status. It replaces
  `engine/status.capabilities` as the answer to "can this server do X"; `useFeature("rollouts")`
  turns the edition into a neutral "needs Standard" fact before the server's 403
  `TIER_NOT_ENABLED`.
- **Workflow `tasks` is a tree, not a list.** An element carrying its own `tasks` key is a
  **task group** (the engine's own test — presence of the key, nothing else); one carrying
  `function` is a task. Any step may set `terminal: true`. Groups nest 8 deep and group ids share
  the task id namespace. Anything asking "what does this workflow run / reference / cost" must
  descend — use `flattenSteps`/`countLeafSteps` from `lib/workflow-steps.ts`, never
  `tasks.length`. `"tasks": []` is a 400 at create since 1.2.
- **Three identifier spaces, and `channel_call` uses the third** (confirmed on a 2.0 server,
  2026-11-17). `channel.channel_id` is the **member id** — what a trace carries as `channel_id`,
  the cron ledger filters on, `trigger` takes and the page is keyed by; `channel.name` is the
  **definition's** `name` (often, not always, the same slug); `workflow.workflow_id` is the
  workflow member's id, the one a channel `requires`, while `workflow.name` is a human title
  ("Auth - login"). A `channel_call` task's `input.channel` names the channel **by `name`**, and
  `orion_messages_total{channel}` and a trace's `channel` are the same name. Resolve a call target
  through `channelsByName`; ids go in URLs (`encodeURIComponent` — a member id may hold a dot).
- **`orion_messages_total` counts ingress, not execution.** A channel reached only by
  `channel_call` — every `internal-*` route in a fan-out design — is dispatched inside the engine
  and gets **no series at all**, in that family or in `orion_workflow_duration_seconds`. So the
  busiest dependency in a system reads as permanently idle unless load is inferred from its
  callers (`deriveLoad` in `lib/traffic-encoding.ts`). Nothing attributes an arrival to a
  particular caller either, so per-edge volume is an upper bound, never a measurement.
- **`status` on `orion_messages_total` gained `unauthorized` in 1.2**, beyond the documented
  `ok` | `error` | `timeout` | `duplicate`. It is refused at the edge and never runs a workflow,
  so counting it as an error reports a correctly-guarded channel as broken, while folding it into
  "ok" hides a channel serving nothing but 401s. `use-metrics.ts` keeps it out of both.
- **The function catalogue is two lists in one.** `GET admin/functions` serves all 26 valid names.
  `source: "orion"` rows carry `input_fields` and are input-schema validated at create;
  `source: "engine"` rows (dataflow-rs built-ins — `map`, `filter`, `log`, `parse_json`, …) **omit**
  `input_fields` entirely. Never index it without a guard. There are no aliases: `validate` is not
  a function name. The field shape is **not in the OpenAPI spec** (hand-typed
  from a live server): each field carries `kind`, `required`, `resolvable` (folds `{"var": …}`),
  and since 1.3 `secret_at` — the paths inside the field that take `{"secret": "name"}`
  (`[""]` = the value itself, `["[].key"]` = each element's `key`). Those are also the only places an
  `env://` / `vault://` string resolves; anywhere else it is refused as `UNRESOLVED_SECRET_REF`.
- **`[vars]` and `[secrets]` (1.3) have no admin endpoint.** Both are server config. A var is
  stamped into every message's `metadata.vars` at ingress (HTTP, Kafka *and* the workflow test
  endpoint) and is recorded in traces on purpose; `channel`, `cookies` and `vars` are
  platform-owned metadata keys a caller cannot supply. A secret is held by the engine, read as
  `{"secret": "name"}` in the five `secret_at` fields, and never appears in a trace or response.
  Misusing one quarantines the channel — `health.channels.quarantined` is `[{ channel, reason }]`,
  objects, not names.
- **Errors:** non-2xx bodies are `{ error: { code, message, details?, request_id? } }`.
  `client.ts` parses all four onto `ApiError`. `details[]` entries are
  `{ path, code, message, expected?, got? }` — `UNKNOWN_FIELD` is how a retired key spelling
  reports itself. Codes: `VALIDATION_ERROR` (not `BAD_REQUEST`), `CONFLICT` (409 on duplicate
  create), `NOT_FOUND` (404 on update with no draft), `CIRCUIT_OPEN` (503).
- **Traces live on the admin plane:** `GET admin/traces` and `admin/traces/{id}`. The old
  `data/traces` paths now resolve as a *channel name* and 404. The single-trace GET also accepts
  the `trace_token` from an async 202 (`x-trace-token` header or `?token=`).
- **Every 2.0 list is cursor-paged, newest first** (traces, audit, DLQ, cron occurrences): no
  `offset`, no `sort_by`; `total` only with `?include_total=true`, so a dashboard that counts
  (the DLQ depth) asks for it. Their pages use `useCursorList` + `LoadMoreFooter`; a one-page
  read (`limit: 1`, the newest N) stays a plain query.
- **Trace list rows are payload-free:** no `task_trace_json`, `input_json` or `result_json` — fetch
  a single trace for those. This is why `use-trace-analytics.ts` aggregates at row level only.
- **Channel `config` sub-fields:** `auth`, `rate_limit` (`requests_per_second`, `burst`,
  `key_logic`, `key_headers`, `on_backend_error`), `backpressure.max_concurrent_per_node`,
  `deduplication` (`header`, `window_secs`, `connector`, `on_backend_error`), `cache`,
  `origin_allow_list` (flat `string[]` — **not** the pre-1.0 `cors` object), `request`, `response`
  (incl. status-keyed `error_bodies`), `validation_logic`, `tracing`. **Unknown keys are refused**,
  so a stale spelling is a 400, not a no-op.
- **Channel auth secrets** (`auth.keys`, `auth.secret`/`secrets`, `auth.jwt_keys[].key`) come back
  masked as `"******"` in a stored channel definition, so two revisions differing only in a key
  diff as equal — that is the server's masking, not a missing change.
- **A deployed entity's identity is its member** (`DeployedEntity`: `revision`, `digest`,
  `member`); the definition holds no id, version, status or timestamps. Equal digests are the same
  definition, whatever the revision numbers say. 1.x's status lifecycle, versions, import/export,
  validate and per-entity dependencies are gone for every entity.
- **Audit logs filter server-side:** `action`, `resource_type`, `resource_id`, `principal`,
  `start_time`, `end_time` (RFC 3339; a trailing `Z` is fine). `limit` clamped 1–1000. The cron
  ledger's `since` / `until` are still zoneless in 2.0 — `api/cron.ts::toNaiveUtc` trims them.
- **Circuit breakers** (`api/circuit-breakers.ts`, the one `admin/connectors/*` surface 2.0 kept): `GET admin/connectors/circuit-breakers` returns
  `{ enabled, scope, instance_id, breakers }`. State is **per-replica**, never cluster-wide.
  There is no reload of any kind in 2.0.
- **Read-only keys and the side-effect-free POSTs.** Orion means a read-only key to be allowed
  `deployment-plans` and `authoring/{scaffold,lint,pack}` (`read_only_may_call`), and the client
  never takes their success as proof of full access (`auth.ts::readOnlyMayCall`). Orion 2.0.0 as
  pinned refuses them anyway — its check compares the path with the nested `/api/v2/admin`
  prefix already stripped — so today a read-only session sees a 403 there like any refusal.
- **Backups:** `POST` (201 in 2.0) / `GET admin/backups`; a listed file carries `created_at` (1.x:
  `modified_at`). SQLite only (400 otherwise). **No restore endpoint.**
- **Trace DLQ entry (2.0):** `payload` and `metadata` are objects (1.x sent `payload_json` /
  `metadata_json` strings). A trace's `duration_ms` is a number with a fraction.
- **Profiling:** sync data requests with `X-Orion-Profile: 1` return `_orion.profile`.
- **`errors[]` in a 200:** `code` names the real failure (`IO_ERROR`, `TIMEOUT_ERROR`,
  `FUNCTION_ERROR`, the connector's lower-case `circuit_open`), with `TASK_ERROR` only as a
  fallback. A 200 does not mean the workflow succeeded.
- **REST channels:** sync channels with a `route_pattern` are invoked by method + concrete path via
  the data-plane catch-all (`api.send()`); routes match byte-exactly. GET/HEAD send no body.
- **Async submissions** answer 202 `{ trace_id, trace_token }`.
- **Metrics carry the `orion_` prefix and every `*_seconds` family is a histogram.** The whole set
  was renamed in 1.0, and `metrics.rs` sets explicit `LATENCY_BUCKETS` on the `_seconds` suffix
  *deliberately* — without them the exporter renders a histogram as a summary with per-replica
  quantiles that cannot be aggregated across a cluster. So there is no `quantile` label to read:
  latency comes from `_bucket`/`_sum`/`_count` via `histogramQuantile()`/`histogramMean()` in
  `api/metrics.ts`. `orion_messages_total{status}` is `ok` | `error` | `timeout` | `duplicate`; a
  duplicate was suppressed by the dedup guard, never processed, so it is kept out of the error-rate
  denominator.
- **Per-workflow cost (1.2):** `orion_workflow_duration_seconds{workflow}` measures a whole run and
  `orion_task_duration_seconds{workflow,task,function}` its task bodies, so the difference is the
  engine's own overhead (condition evaluation, group gating, loop bookkeeping, audit writes). A
  workflow its condition or rollout gate rejected is not recorded; a looping workflow records once.

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with the `/api/v2` base path, sends the admin credential and applies the probe-and-hold-back rule (`auth.ts`, above), parses the structured error envelope onto `ApiError` (incl. `details[]`, `requestId` and 2.0's `connector`), and exports `buildQuery()`, `unwrap()`, and `api.send()` for arbitrary-method data-plane calls. `RequestOptions.changeContext` sends `X-Orion-Change-Context` so a multi-request promotion's audit rows can be grouped. Domain modules: `deployments.ts`, `definitions.ts` (incl. `test`), `connections.ts`, `connector-packages.ts`, `authoring.ts`, `runtime.ts`, `channels.ts` (only the cron `trigger`), `circuit-breakers.ts`, `traces.ts`, `trace-dlq.ts`, `engine.ts`, `audit.ts`, `backup.ts`, `functions.ts`, `data.ts`, `cron.ts`, `cache.ts`. All types hand-written in `types.ts`.
- **`src/hooks/`** — TanStack Query wrappers. One hook file per domain (`use-channels.ts`, `use-workflows.ts`, etc.). Query keys are `["entity", params]` arrays. Mutations invalidate via `queryClient.invalidateQueries`. The client default is `staleTime: 30_000` (a page visited twice in a row does not refetch its lists; polled queries keep their own `refetchInterval`, and invalidation ignores staleness), and every paginated list hook sets `placeholderData: keepPreviousData` so a page turn holds the last page instead of dropping to a skeleton.
- **`src/pages/`** — Route-level components. Named exports like `ChannelsPage`, `WorkflowDetailPage`. Data fetching via hooks, not inline.
- **`src/components/ui/`** — Shadcn-style primitives using `React.forwardRef`, CVA variants, and
  `cn()` for class merging: `Button`, `Card`, `Badge`, `Table`, `Tabs`, `Dialog`, `Input`,
  `Textarea`, `Select`, `Label`, `Checkbox`, `Switch`, `Callout`, `Separator`,
  `Skeleton`, `Sparkline`. `field.ts` holds the border/focus/invalid chrome shared by
  Input/Textarea/Select — change it there, not per field. `Select` renders a wrapper div so it can
  overlay a themed chevron: `className` sizes the *control* (as callers already expected),
  `selectClassName` reaches the `<select>` itself.
- **`src/components/shared/`** — Shared composed components: `EntityHistoryPanel` (a deployed entity's states across revisions, with a definition diff), `NotDeployedState` / `NothingDeployedState` / `QuarantineBadge` (`deployed-state.tsx`), `JsonViewer`, `JsonDiff`, `PageHeader`, `ConfirmDialog`, `PaginationFooter`, `Fact`/`InlineFact`, `ConfirmButton`, `FilterBar` (with `FilterTextInput` and `UnknownOption`), `EmptyState`/`NoMatches`, `ErrorState` (the one
  way a page reports a failed load — reads status, code, field details and request id off
  `ApiError`, with Retry) and `ErrorBoundary`.
- **`src/components/layout/`** — `AppLayout`, `Sidebar`, `Header`. `AppLayout` owns the two
  sidebar states: folded to an icon rail (the control at the sidebar's foot, remembered in
  `localStorage["orion-sidebar"]`) and, below `md`, a drawer behind the header's menu button
  that closes on navigation, Escape or the backdrop.
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `formatDate()` (absolute, in the
  chosen zone, with a zone marker), `formatWhen()` (relative under a day, absolute beyond — the
  list-cell rendering), `formatInstant()` (the ISO instant), `formatDuration()`, `formatRelative()` ("12s ago" / "in 40m"; pair it with the
  absolute `formatDate()` in a `title`), `toRfc3339()` (a `datetime-local` value to the server's
  form, through the zone preference), `parseJson()` (safe parse; returns the *raw string* on failure, not null), `downloadJson()` (the shared export blob helper), and `parseServerDate()` / `serverTime()`: **the admin plane serialises `chrono::NaiveDateTime` — `2026-09-05T12:13:55`, no zone — and every such value is UTC.** `new Date()` reads a zoneless string as local time, so go through these for anything time-based; `formatDate` already does.
- **`src/lib/use-pagination.ts`** — `PAGE_SIZE`, the page a browser-paged list (`useListState`'s `offset` + `PaginationFooter`) shows.
- **`src/lib/time-zone.ts`** + `time-zone-provider.tsx` / `use-time-zone.ts` — the display
  zone (`local` | `utc`, `localStorage["orion-timezone"]`), chosen in the header's Display menu
  (which also holds theme, incl. "Follow the system"). A module variable is what
  `formatDate` reads, so non-React code sees the same value; the provider is what re-renders on
  a change. Every absolute time in the app goes through `formatDate`, which is how one
  preference reaches every page.
- **`src/lib/editor-types.ts`** + `shared/json-editor.tsx` / `json-editor-view.tsx` — the JSON
  editor (CodeMirror 6). `json-editor.tsx` is a `lazy` wrapper and the only import a page should
  use; the CodeMirror runtime lives in `json-editor-view.tsx` and its own `codemirror` chunk,
  fetched the first time an editor mounts. A lint or completion source is *handed* the parse
  tree (`LintContext`, `CompletionRequest`) rather than importing CodeMirror — an import from
  `@codemirror/*` outside the view module undoes the split. `lib/json-path.ts` maps a
  `lintSteps` path (`tasks[1].function.name`) to a range in the document; `lib/workflow-completions.ts`
  is the catalogue-backed source (function names inside `function.name`, that function's
  `input_fields` inside `input`, the keys a step takes, the `on_rejection` / `on_failure` spellings) and handles a
  string still being typed (an error node to the parser, not a `String`). `onRun` binds
  Mod-Enter above the default keymap (which would insert a blank line): the console sends on it
  and the workflow dry run runs on it.
- **The 1.12 revamp's single sources.** Pages ask these rather than re-deriving:
  `lib/function-effects.ts` (above), `lib/trace-error.ts`, `lib/trace-timeline.ts` (steps →
  phases, iterations, gaps, the failing step; `traceWorkflowId`, `stepDataGap`),
  `lib/trace-axis.ts` (split/linear time axis), `lib/trace-step-uses.ts`,
  `lib/metrics-state.ts` (the copy for every `MetricsState`), `lib/audit-vocabulary.ts` (filter
  labels and past-tense verbs), `lib/cron.ts` (`isInFlight`, `isCancellable`, `cronBacklog` —
  the dashboard tile and the incident list share it), `lib/audit-routes.ts::entityRoute`,
  `lib/domains.ts` (channels grouped by shared name prefix or tag, `shortName`,
  `middleTruncate`), `lib/traffic-encoding.ts` (`formatMs`, `formatPct`, `formatRatio`,
  `trafficLine`), `lib/utils.ts::plural`, `shared/fact.tsx`, `shared/confirm-button.tsx`,
  `ui/popover-menu.tsx`.
- **Pages' own modules.** Trace timeline: `components/traces/` (`TraceSteps`, `TraceTimeline`,
  `StepDetail`). Workflow lenses: `components/workflow/` + `lib/workflow-lens.ts` (rows,
  cost view, read-outs). System Map: `lib/dependency-graph.ts` (domains → connector/plugin/model
  hubs, measured edges, blast radius, `mapSearch`), `lib/health-grid.ts`, `lib/change-pins.ts`
  + `hooks/use-change-pins.ts`, `lib/map-fit.ts`, `components/graph/`. Operations:
  `lib/incidents.ts` (failures grouped by error signature, resolved by later success, acked
  per browser in `orion-incidents-ack`), `components/operations/`. Caches:
  `pages/caches.tsx`, `lib/cache-namespaces.ts`. Admin: `components/admin/`.
- **Metrics pipeline.** `/metrics` is fetched and parsed in a worker (`api/metrics.worker.ts`,
  low fetch priority) that replies with a transferred `Float64Array` and sends series
  descriptors only when the set changes; `api/metrics.ts` interns them so the 60-sample ring
  buffer shares labels across samples, indexes each snapshot by family once (`family()`), and
  memoises `deltaSnapshot` per pair. `useChannelTraffic(...).state` is `loading` | `off` |
  `error` | `warming` | `live` — **pending is loading** (a retry paused in a background tab has
  not answered), and only a 404 or an empty exposition is `off`. `hooks/use-ops-metrics.ts`
  reads connectors per channel (`useConnectorTraffic`), per-task cost (`useWorkflowCost`, a task
  summed across the function labels it ran under), the subsystems (`useSubsystemMetrics`) and
  cache hits (`useCacheHitsByChannel`).
- **`src/lib/onboarding.ts`** + `shared/getting-started.tsx` — the first-run checklist the
  dashboard leads with while the engine serves no channel (`isFirstRun`, `firstRunSteps`, five
  steps ticking from the live counts); dismissed per browser
  (`localStorage["orion-getting-started-dismissed"]`).
- **`src/lib/use-now.ts`** — `useNow(intervalMs)`: the current time as ticking state, for "ago"
  labels and age windows. `Date.now()` in render trips the `react-hooks/purity` lint.
- **`src/lib/nav.ts`** — the page registry (sections, icons, keywords, `g`+key shortcuts, which
  live count sits beside an item) and `navItemFor(pathname)`.
- **`src/lib/page-title.ts`** — `setPageTitle` / `setFallbackTitle`: the tab title, with the page
  winning over the shell (a child's effect runs before its parent's, so the shell yields).
- **`src/lib/faults.ts`** + **`src/hooks/use-faults.ts`** — the map's fault overlay: quarantined
  channels and failed connectors from `/health`, open breakers from this node's map, keyed by
  channel and connector name; `faultsFor(node)` is what a node draws. `useMapTelemetry(graph)`
  is what both canvas hosts (the map, a detail page's neighbourhood) call: the faults plus a cron
  channel's next fire, so a cron card reads the same on either. `lib/breakers.ts` owns the
  `channel:connector` key (`parseBreakerKey`, `breakerRows`, `openBreakers`, `isBreakerOpen`).
- **`src/hooks/use-attention.ts`** — `useAttentionItems(windowSec)`: "Needs attention" as data
  (severity-ordered, each with the page to act on), shared by the dashboard and the sidebar's
  Operations count so the two cannot disagree; `useNavCounts()` adds DLQ, breaker and cron
  backlog counts. Failing channels are judged over the traffic window once a second sample
  exists, cumulative before that.
- **`src/lib/use-unsaved-changes.ts`** + `shared/unsaved-changes-dialog.tsx` — the form guard.
  `useBlocker` reads refs at navigation time so a save that navigates away is not blocked; the
  save handler calls `markSaved()` first.
- **`src/lib/use-url-filters.ts`** + **`src/lib/use-list-state.ts`** — view state in the URL.
  `useUrlFilters(keys)`: `values` read as strings (empty when absent); `set(patch)` replaces the
  history entry and changes several keys in one navigation — two calls in a row each start from
  the last render's params and the second undoes the first (react-router's functional updater
  reads the render's params). The map, the dashboard and the console use it directly.
  `useListState(keys, sortFields?, options?)` is a list page's whole view — its filters,
  `sort`/`order` and `offset` — as URL keys: `update(patch)` re-anchors to the first page,
  `prev`/`next` page, `sortQuery` is the request's `sort_by`/`sort_order`, and `sort` feeds
  `EntityTable`. `options.values` declares what a **closed-enum** filter accepts
  (`CHANNEL_TYPES`, `TRACE_STATUSES` —
  all in `api/types.ts` beside their type alias): a URL carrying anything else reads as unset, so
  the control, the request and the rows agree, where an unchecked value used to leave the
  dropdown reading "All statuses" over a list the server had filtered to nothing. The URL keeps
  what it was handed — rewriting it would mean navigating during a render — but nothing
  downstream sees it. An **open** vocabulary (a trace `mode`, an admission verdict, an audit
  action, an occurrence status) is not validated: it is shown instead, through `UnknownOption`.
  `hasFilters` is whether anything is narrowing the list — what tells `NoMatches` from a page's
  first-run state — and `clear()` drops every filter, keeping the sort. Every
  list page (Channels, Workflows, Connectors, Plugins, Traces, Audit, DLQ, the Schedules ledger)
  keeps its state this way, so a filtered, sorted, paged list is a link. `nextSort` cycles
  unsorted → asc → desc → unsorted; the sort fields are the server's own `sort_by` values
  (channels: `priority`, `name`, `status`, `channel_type`, `protocol`, `created_at`,
  `updated_at`; workflows drop the type columns; plugins take `plugin_id`; connectors `name`,
  `connector_type`, `created_at`, `updated_at`). The 2.0 lists (traces, audit, DLQ, the
  Schedules ledger) have no server sort: their state is filters only.
- **`src/components/shared/entity-table.tsx`** — `EntityTable`: the list table every entity page
  draws — a `SortableHead` header row, `PAGE_SIZE` skeleton rows while loading, the empty state
  across the full width, and one activatable row per entity — from a TanStack `table`, the
  `sort` from `useListState`, an `empty` node and `onOpen(row)`. `lib/table.ts` holds only
  `listTableFeatures`.
- **`ui/table.tsx`** — `TableRow` takes `onActivate`: the row takes focus and Enter or Space
  open it, with the pointer and a focus ring inside the row (a `<tr onClick>` alone is invisible
  to the keyboard); a key that started on a link or button inside the row is left to it.
- **`src/lib/toast-error.tsx`** — `toastError(title, e)`: the one way a mutation reports failure.
  Shows `ApiError.details[]` and the request id, with a "Copy request id" action. Every hook's
  `onError` goes through it. `lib/batch.ts` (`settleAll`, `reportBatch`) is the shape of a bulk
  mutation — one request per item, "n done, m refused"; `lib/clipboard.ts::copyText` the one way
  to copy with a toast either way.
- **`src/lib/retry-safety.ts`** + `hooks/use-retry-safety.ts` + `shared/retry-safety-warning.tsx` —
  the guard in front of a DLQ requeue and a cron occurrence retry: `retryRisks(steps, catalogue)`
  names the tasks whose function is `unsafe_write` or `depends_on` its input. It reads the
  revision the head deploys (`useWorkflow`, the primary under a canary), because a retry runs on
  the node's current generation, not the one the failed run saw. Rendered in the DLQ entry and
  bulk dialogs, on an occurrence page and on a cron channel's occurrences tab.
- **`src/lib/trace-payload.ts`** — `firstTaskPayload` (on `executionTrace`; a v4 trace's `initial.data`): the request as the first
  task saw it, the closest thing to the original input a trace keeps (the read carries no raw
  request). "Re-send in console", the console's "Last trace's input" and the dry run's "Use last
  trace's input" all read it.
- **`src/lib/media-query.ts`** — `useMediaQuery(query)`, one cached `MediaQueryList` per query:
  how a component picks one container over another (the map inspector's column above `lg`, a
  sheet below it) instead of mounting both and hiding one. `lib/motion.ts::useReducedMotion` is
  built on it, for motion started from script (the map's viewport travel); CSS animation is
  stopped by the global `prefers-reduced-motion` rule at the end of `index.css`.
- **`src/lib/storage.ts`** — `readStorage` / `writeStorage` / `readStorageJson` /
  `writeStorageJson`: `localStorage` behind the one contract every per-browser preference needs
  (a read that answers `null` and a write that does nothing when the accessor throws), plus
  `readSessionStorage` / `writeSessionStorage` for the one credential (the admin key). No other
  file touches browser storage.
- **`src/hooks/use-registry.ts`** + **`src/lib/deployed-registry.ts`** — what the head deploys,
  as entities: `useRegistry()` reads the head manifest, fetches every workflow, channel and plugin
  definition it names (once — content-addressed), and projects each member exactly as the
  server's `channel_row` / `workflow_row` / `plugin_row` do (`orion-runtime/src/runtime/
  definitions.rs`): identity and the required workflow from the member, the rest from the
  definition. The single source for "which entities exist" — `useChannels` / `useWorkflows` /
  `usePlugins` and their single-entity hooks (`notDeployed` for an id the head lacks), the
  palette, the console, caches, breakers, the DLQ and the attention list all read it, and the
  derivation is shared at module scope. Also `useEntityHistory(kind, id)` (an entity's states
  over the newest `HISTORY_DEPTH` revisions, for `EntityHistoryPanel`), `useNodeHealth()` and
  `useQuarantineReason(entity)` (this node's `quarantined_entities`, keyed by
  `memberRefKey` — meaningful only when it applied the head). List pages filter, sort and page in
  the browser (`lib/deployed-list.ts`); a head with none of them renders `NothingDeployedState`.
- **`src/hooks/use-entity-index.ts`** — `useEntityIndex()`: the registry indexed and built into
  the system graph once, for the map, the dashboard and a neighbourhood. It carries no connectors
  until the connection pages land (phase 4).
- **`src/hooks/use-export.ts`** — `useExport(run)`: an export button's pending flag and its
  outcome toasts; the callback fetches, downloads (`downloadJson` / `downloadText`) and returns
  the success line.
- **`src/hooks/use-last-trace-input.ts`** — `useLastTraceInput(channel)`: the newest trace through
  a channel and its first task's payload on demand, for the console and the dry run.
- **`src/components/shared/kpi-card.tsx`** and **`outcome-bar.tsx`** — the KPI tile (dashboard,
  Schedules) and the outcome bar / legend / rate-and-errors sparklines (map card, inspector,
  channel page), each defined once.
- **`src/components/shared/`** also holds `Breadcrumbs` and `ChannelTrafficCard` /
  `ChannelRecentTraces` (a channel's own window on its page). `components/connections/`
  (`ProbeBadge`, `ProbeResult`) and `components/packages/` (`PackagePicker`, `PackageFileList`,
  `LintReport`, `UploadPackageDialog`, `PackageStudio`, `TierBadge`, `PackageStateBadge`) are the
  Connect section's own.
- **`src/lib/topology.ts`** — the entity index (`buildIndex`) and reference extraction
  (`channelCallTargets`, connector refs) that `system-graph.ts` builds on. The per-entity graph
  on a detail page is `components/graph/neighbourhood-map.tsx`: a one-hop projection of the
  System Map — same canvas, same encodings, live traffic and faults — which replaced the old
  `RelationshipGraph` and its second visual language on 2026-09-05. For a single workflow prefer
  `workflowsApi.dependencies()`, which is the server's own answer and also reports dynamic
  `channel_call` targets. Call targets resolve through `channelsByName` — see the identifier
  note above.
- **`src/lib/system-graph.ts`** — the *whole* system as one graph, for the System Map:
  `buildSystemGraph` (one node per channel with its workflow folded in, edges from `channel_call`,
  plus fan-in/fan-out, tier and connector fan-in) and `neighbourhood` (bidirectional blast
  radius). Channels are keyed by **name**, because that is what calls and metrics both use.
  Connectors are deliberately not nodes: one used by 51 of 62 workflows adds an edge everywhere
  and distinguishes nothing, so they ride the referencing node and render as a rail.
- **`src/hooks/use-metrics.ts`** — `useChannelTraffic(windowSec)` is the windowed view every
  page shares (`TRAFFIC_WINDOWS`, default 5 min, bounded by the 60-sample ring buffer): per
  channel ok / failed / rejected / duplicate, `byStatus`, a windowed p95 from **bucket deltas**
  (`deltaSnapshot(base, cur)` is a valid histogram because counters are monotonic), plus totals
  (`errorPct`, `p95Ms`, `meanMs`), per-poll `series` / `seriesFor(channel)` for sparklines,
  `spanLabel` ("last 48 s" / "waiting for a second sample" / "metrics off") and
  `activeInBuffer` (channels that moved across the whole buffer — the canvas's hysteresis). The
  windowed reduction is computed once per poll per window at module scope and shared by every
  instance on the page; per-channel splits are cached by snapshot. `useMetrics()` keeps the
  cumulative figures (workflow cost, the fallback before a second sample), memoised per
  snapshot. Every reader of `/metrics` polls at `METRICS_POLL_MS`; `trafficWindowFromParam`
  reads `?window=`.
- **`src/lib/traffic-encoding.ts`** — how telemetry becomes shape and colour: health thresholds,
  the sqrt dot scale (a dot reads as an *area*), and `deriveLoad`, which propagates load in tier
  order to the channels the exporter cannot see. A `HealthLevel` is a colour *slot* — `idle` /
  `healthy` / `notice` / `warning` / `critical` — and what it means depends on the colour metric:
  `legendFor(colorMetric)` names the slots (`notice` is "rejected" in health mode, "100–500 ms"
  in latency mode, "draft" in lifecycle mode). `errorLevel` is the error-share banding the
  dashboard KPI shares with the map.
- **`src/lib/map-layout.ts`** — the map's layout: one lane per call tier, with **every** channel
  nothing calls in the entry lane whether or not it calls anything itself (an entry channel that
  makes no calls is reached over its route — it is not an orphan, and the old ELK-plus-leftover-grid
  layout that banded such channels as "not reached by any call" was wrong about that). Entries
  sharing one dependency set (3+) are drawn as a **cluster** box with a single edge per callee, so
  eighteen routes that all call `internal-session-check` are one line, not eighteen; the call-less
  entries are just another cluster ("no calls out"). Barycenter ordering keeps a hub among its
  callers. A cluster can be `collapsed` (`LayoutOptions.isCollapsed`): it lays out as one
  summary box and its members take the box's position, so React Flow animates them in and out.
  Pure, synchronous, no dependency.
- **`src/components/graph/traffic-map.tsx`** — the canvas. Level of detail follows
  `useViewport().zoom` (`LOD_ZOOM`): a dot and a large name below it, the full card above.
  Clusters are nodes (`ClusterNode`): a click toggles collapse, a map of `COLLAPSE_MAP_AT`+
  channels starts with clusters of `COLLAPSE_CLUSTER_AT`+ collapsed, and the cluster holding the
  selected channel is always open. `hops` bounds the blast radius
  (`neighbourhood(graph, id, hops)`; the page reads `?hops=`, the detail pages' neighbourhood
  map is fixed at one); the MiniMap appears past 15 nodes. A card stays expanded while its channel
  is in `TrafficWindow.activeInBuffer`, so a channel quiet for one window does not shrink and
  shuffle the lanes; level of detail is a boolean `useStore` selector, so a pan or zoom does not
  re-render the canvas per frame. `faults`, `hops` and `nextFire` are required props — the host
  supplies them through `useMapTelemetry`.
- **`src/lib/workflow-steps.ts`** — Reading a workflow's step tree: `isTaskGroup`, `groupMembers`,
  `flattenSteps`, `countLeafSteps`, `countGroups`, `countTerminal`, `groupDepth`, plus `lintSteps`
  (client-side shape check reporting at the coordinate the author typed). Mirrors the server's
  `engine/steps.rs`; re-implemented rather than imported from `dataflow-ui` so the API layer does
  not depend on the visualizer package.
- **`src/lib/workflow-mapper.ts`** — Maps API `Workflow` (has `workflow_id`) to
  `@goplasmatic/dataflow-ui` `Workflow` type (has `id`). Walks the step tree rather than casting:
  the visualizer requires `function.input`, which the API type leaves optional. dataflow-ui 4
  draws `on_rejection`/`on_failure` itself, so they pass through.
- **`src/lib/cron.ts`** — Reading a cron channel: `isCronChannel`, `cronTransport` (the one
  reader of `transport_config` as a schedule), `CRON_REFUSED_CONFIG_KEYS` +
  `stripCronRefusedConfig` (what a protocol switch must drop), `lintCronExpression` (six fields,
  while typing — Validate is the authority), `isRetryable`, the policy option lists and status
  labels.
- **`src/lib/health.ts`** — `componentRoute`: which page acts on a degraded `/health` component,
  or null when only the health report explains it (callers fall back to `/engine#component-…`).
- **`src/components/shared/load-issues.tsx`** — `LoadIssuesReport`: the four lists a generation
  refused, from `engine/status.load_issues` or `/health`, rendered once so the two cannot drift.
- **`src/api/cron.ts`** — the ledger; `channelsApi.trigger` is the manual cron run. Hooks in
  `use-cron.ts`. `use-metrics.ts` also exposes `useCronMetrics` (pending gauge, lag p95, occurrences by
  status, lease failures) and `usePluginMetrics` (per-function invocations, errors, p95), both
  reading the shared `["metrics"]` poll.

### Routing

React Router v7 in `src/app.tsx`. All routes nest under `AppLayout` (sidebar + header + `<Outlet />`).

```
/                   -> OperationsPage
/deployments        -> DeploymentsPage (2.0: the revision history, head and what this node serves)
/deployments/:revision -> DeploymentDetailPage (?tab=members|changes|convergence|manifest,
                                     ?compare=<revision> for the Changes tab; default its parent)
/system-map         -> SystemMapPage (view state in the URL: ?lens=deps|calls|grid (absent:
                                      auto) &group=prefix|tag:<a,b> &select=<channel name |
                                      connector:<name>> &q=&tag=&lifecycle=all&window=&size=
                                      &colour=&hops=1|2|all)
/channels           -> ChannelsPage (the head's channels; ?q= name/id/route, ?protocol=, ?type=,
                                     ?tag=, all in the browser)
/channels/:id       -> ChannelDetailPage (by member id; ?tab=overview|occurrences|config|
                                     relationships|history|definition)
/workflows          -> WorkflowsPage (?q=, ?tag=)
/workflows/:id      -> WorkflowDetailPage (?lens=structure|deps|cost|run, ?trace=<id> pins
                                          the run the Last run lens overlays; ?tab=test|history|
                                          definition; ?revision= under a canary)
/plugins            -> PluginsPage (?q=, ?tag=)
/plugins/:id        -> PluginDetailPage
/{channels,workflows,plugins}/new, …/:id/edit -> redirect to the list / the entity (1.x's forms)
/connections        -> ConnectionsPage (one row per connection; ?q=, ?deployed=yes|no, ?family=)
/connections/:id    -> ConnectionDetailPage (?revision=<n> selects one, default the deployed;
                                            ?compare=<n> diffs two)
/provider-packages  -> ProviderPackagesPage (?tab=studio; ?upload=1 opens the upload dialog)
/provider-packages/:digest -> ProviderPackageDetailPage (?tab=overview|operations|files|manifest)
/connectors/*, /models/* -> redirect to /connections; /packages -> /deployments
/traces             -> TracesPage (?channel= and ?status= pre-filter)
/traces/:id         -> TraceDetailPage (accepts ?token= for async trace polling; ?step=<index>
                                       selects a timeline step)
/caches             -> CachesPage (?namespace= highlights one; where audit rows link)
/trace-dlq          -> TraceDlqPage
/schedules          -> SchedulesPage (accepts ?channel_id= to pre-filter the ledger)
/schedules/occurrences/:id -> OccurrenceDetailPage
/circuit-breakers   -> CircuitBreakersPage (?key=channel:connector highlights that row)
/audit              -> AuditPage
/console            -> ConsolePage (?channel=<name> preselects it and seeds its REST route)
/engine             -> EnginePage (?tab=health|cluster|maintenance; #component-<name> scrolls
                                   the health report to that row)
/settings           -> redirect to /engine, keeping search and hash (the page's name until 2026-09-05)
*                   -> NotFoundPage
```

The router is a **data router** (`createBrowserRouter` + `RouterProvider`), because the
unsaved-changes guard on every form is `useBlocker`, which only exists there. `AppLayout` wraps
the `<Outlet />` in an `ErrorBoundary` keyed on the path, so a page that throws renders
`ErrorState` instead of blanking the console; it also sets the fallback tab title from the nav
registry and runs the `g` + key shortcuts.

A new page needs two registrations: a route in `src/app.tsx` and an entry in `src/lib/nav.ts`,
which feeds the sidebar (grouped Monitor / Deploy / Build / Control / Govern, Plugins and Models hidden
while their runtime is off and none exist, with live counts from
`useNavCounts`), the palette's "Go to" group, the `g` + key shortcuts and the fallback tab
title. A list page names the tab through `PageHeader`; a detail page through `Breadcrumbs`
(`lib/page-title.ts` lets the page win over the shell).

There are no entity forms in 2.0.0 (D1 = A): definitions and connection revisions are authored in Git and applied with `orion-cli`. JSON the console does take — the console's payload, a workflow test's payload and edited copy, a provider lock — is authored in the `JsonEditor`, never a `Textarea` (both payload editors run on ⌘ Enter through `onRun`).

### API Proxy

Dev server proxies `/api`, `/health`, `/healthz`, `/readyz`, `/metrics` to `process.env.ORION_URL` (default `http://localhost:8080`). The API client prepends `/api/v2` to all paths. With `ORION_ADMIN_AUTHORIZATION` set (`Bearer <key>`), the dev proxy — like the image's nginx (`nginx.conf.template`) — adds it to requests that carry no `Authorization` of their own, so nobody is asked for a key. Anyone who can reach that UI then acts with the key: only behind your own sign-in, and prefer a read-only key.

### Visualization Libraries

- **`@goplasmatic/dataflow-ui`** (4.0) — `WorkflowVisualizer` renders workflow task pipelines with tree/flow/graph views and optional debug tracing; it draws `loop.setup`, `for_each` and the v4 step policies, which `lib/workflow-mapper.ts` passes through. The Structure lens and the form preview open on the workflow with `initialSelection="first-workflow"` (4.0's answer to dataflow-rs#70, replacing the click-the-explorer-row stopgap). Its WebAssembly engine (`dataflow_wasm_bg.wasm`, ~3.6 MB) is a separate asset fetched only when the engine initialises. CSS imported in `main.tsx`.
- **`@goplasmatic/datalogic-ui`** — `DataLogicEditor` renders JSONLogic expressions as interactive flow diagrams. Read-only (`editable={false}`) in viewers; editable with `onChange` in the workflow form's condition editor and the channel config's validation / key-logic / JWT authorization-logic fields (via the shared `LogicField` in `config-field.tsx`). CSS imported in `main.tsx`.
- **`@xyflow/react`** is pinned exactly (no caret) to the version `@goplasmatic/dataflow-ui`
  declares as an *exact* dependency. A root range that resolves past it makes npm nest a
  second copy under dataflow-ui and the `react-flow` chunk doubles (178 kB → 301 kB). When
  dataflow-ui moves, move the pin with it; `npm ls @xyflow/react` must show one copy.
- **CodeMirror 6** (`codemirror`, `@codemirror/*`, `@lezer/*`) — the JSON editor behind
  `shared/json-editor.tsx`; see `lib/editor-types.ts`. Themed through the CSS variables in
  `json-editor-view.tsx` (never a bundled theme), split into its own chunk by `vite.config.ts`.

### Pagination

**2.0 lists are cursor-paged** (`Page<T>`, above): `useCursorList(key, fetchPage)` loads a page
at a time and accumulates (`hasMore` / `loadMore`), and `LoadMoreFooter` is its footer — there is
no page N and no "previous" to offer. The filters stay in the URL (`useListState`); the depth
loaded does not, because a cursor is opaque. **`total` is optional**: treat an absent total as
"unknown", never zero. A list the console holds whole — the head's members, every connection —
pages in the browser instead (`offset` in the URL, `PaginationFooter`).

## Conventions

- **Imports:** Always use `@/` path alias (maps to `src/`).
- **File names:** kebab-case (`use-workflows.ts`, `app-layout.tsx`). Exports are PascalCase for components, camelCase for functions/objects.
- **Styling:** Tailwind utility classes only. Use `cn()` for conditional/merged classes. Theme
  tokens are CSS variables in `src/index.css` (hex + `rgba`, mapped into Tailwind via
  `@theme inline`). Never hardcode a colour — no `text-[#4CBD97]`, no `bg-slate-800`.
- **Component variants:** Use `class-variance-authority` (CVA) with `VariantProps` typing. Keep
  `xVariants` unexported — a non-component export from a component file trips the
  `react-refresh/only-export-components` lint rule.
- **Semantic vs chart colour:** `--success` / `--warning` / `--info` / `--destructive` are *ink*
  tokens, carrying a per-theme value that is readable as text (the brand green `#4CBD97` and amber
  `#FFD167` are ~2:1 on white and must never be text in light mode). `--chart-1…5` are data-viz
  fills, brand-exact and identical across themes. Use semantic tokens for anything with a label;
  use chart tokens only for chart geometry. `statusChartColor()` in `lib/status.ts` returns the
  concrete hex recharts needs, since CSS variables do not resolve in SVG fills.
- **Elevation:** four steps (`shadow-xs` → `shadow-lg`), theme-aware — light casts a soft ink
  shadow, dark a deeper near-black one. Cards carry `shadow-xs` by default; pass `interactive` to a
  `Card` that navigates for hover elevation.
- **Inline status banners:** use `Callout` (`variant` = info | success | warning | destructive |
  muted) rather than re-deriving `rounded-md border border-X/40 bg-X/10 … text-X`.
- **Form captions:** use `Label`, never a bare `<label>`, so weight/spacing and the `required`
  marker stay consistent. Wrapping labels around a control (checkbox rows) stay plain `<label>`.
- **List filters:** wrap the filter row in `FilterBar` and size each control with `FILTER_W`. A bare
  `Select` is `w-full`; without a width two dropdowns stretch across the whole page. A free-text
  filter is a `FilterTextInput`, never a bare `Input`: every commit is a URL navigation *and* a
  list request, so what is typed stays local until the typing pauses (Enter and blur commit at
  once). These filters are **exact** matches server-side — case-insensitive, untrimmed, no prefix
  — which is why they are placeheld "Exact tag…" rather than dressed as a search. A dropdown over
  a closed enum declares its values to `useListState`; one over an open vocabulary carries an
  `UnknownOption`.
- **Focus rings:** `focus-visible:ring-2 focus-visible:ring-ring/60` plus an offset in the
  surrounding surface colour. A 1px ring is invisible against a filled control.
- **Icons:** `lucide-react` exclusively.
- **Tables:** `@tanstack/react-table` with `createColumnHelper<T>()`, server-side sorting via query
  params. A list page keeps its filters, sort and page in the URL through `useListState` and
  renders `EntityTable`, which owns the sortable header row, the `PAGE_SIZE` skeleton, the empty
  state and the activatable rows; a hand-drawn table gives a row `onActivate` so the keyboard
  can open it. Columns that need live data (a quarantine set, a breaker map, this node's plugin
  loads) are built by a `buildColumns(...)` factory inside a `useMemo`, not a module constant.
  An export button is `useExport`.
- **No index files:** Import directly from the file (`@/components/ui/button`, not `@/components/ui`).
- **Entity status:** a deployed entity has none — it serves, or this node quarantined it
  (`QuarantineBadge`); a provider package is admitted, revoked or only stored (`PackageStateBadge`).
- **Status colours:** add new status/state strings to `src/lib/status.ts` rather than inlining — every map there falls back to neutral, so an unmapped value degrades silently to grey.
- **Untoasted mutations:** validate/test/dry-run hooks are bare `useMutation({ mutationFn })` with no toast or invalidation — their results render inline, and a "failure" (invalid config, unreachable backend) is information rather than an error.
- **Failed mutations:** `toastError(title, e)` from `lib/toast-error.tsx`, never `toast.error`
  with `e.message` — the field findings and the request id are the part a person acts on. A
  batch (requeue every entry shown, reset every open breaker) is `settleAll` + `reportBatch`
  from `lib/batch.ts`: one request per item, reported as "n done, m refused".
- **Load failures:** a page that cannot load its entity renders `ErrorState` (with `refetch` as
  `onRetry` and a `backTo`), never a bare "Failed to load" line.
- **Empty lists are two different facts:** an empty registry gets the teaching `EmptyState` (what
  the primitive is, and the button that creates one); a list its filters narrowed to nothing gets
  `NoMatches` with a "Clear filters" action, off `hasFilters`. Answering a filtered list with the
  first-run pitch tells an operator the system is empty when it is not — `pages/list-empty-states.test.tsx`
  holds every page to the distinction.
- **Times:** `formatWhen()` for list cells (relative under a day, absolute beyond) and
  `formatRelative()` for anything a person watches live (trace and audit lists, the dashboard),
  both with the absolute `formatDate()` in the element's `title`. Every absolute time goes
  through `formatDate` — `toLocaleString` by hand bypasses the zone preference.
- **Per-browser preferences** live in `localStorage`, never the server: `orion-timezone`,
  `orion-sidebar`, `orion-getting-started-dismissed`, the theme key, the
  console's history and headers, the palette's recents (`orion-palette-recent`), a workflow's
  last dry-run payload (`orion-dryrun-<id>`) and whether its diagram is folded
  (`orion-workflow-diagram`), all through `lib/storage.ts`, so a page renders correctly when
  the key is absent or the accessor throws (private mode).
- **Links between pages carry state in the URL:** every list page's filters, sort and page
  (`?status=&tag=&sort=&order=&offset=` and their kin on Channels, Workflows, Connectors,
  Plugins, Traces; `?action=&resource_type=&resource_id=&principal=&start=&end=` on Audit;
  `?channel=&exhausted=` on the DLQ; `?channel_id=&status=&since=&until=` on the Schedules
  ledger), the console's `?channel=&method=&path=`,
  the map reads `?select=` (and every filter),
  the dashboard and the map `?window=`, the console `?channel=`, the breakers page `?key=`,
  traces `?channel=&status=`, the connector page `?test=1`. A link that lands on an unfiltered
  list and asks the operator to find the thing again is a bug. Router *state* carries what must
  not be in a URL: an async trace token, a payload handed to the console, the trace list's page
  of ids (for newer / older on the detail).
- **The console remembers in this browser only:** request history and per-channel headers live in
  `localStorage` (`orion-console-history`, `orion-console-headers`); a guarded channel's credential
  goes in the headers table, and the form warns when the channel's `auth` header is missing.
