# Changelog

All notable changes to Orion UI. The version follows the Orion server release the
console targets.

## [2.0.0] — unreleased

The console now speaks **Orion 2.0 (`/api/v2`)** and its deployment model. A node
serves exactly one numbered deployment manifest; definitions are content-addressed
and shipped from Git with `orion-cli`. The console operates that head.

### Added

- **Deployments**: the revision history (head, the revision this node serves, epoch),
  a revision's members and raw manifest, the changes against its parent or any other
  revision down to a definition line diff, convergence across this node or every
  observed node, and rollback with a head→target preview, a required reason and a
  stable idempotency key.
- **Deployed entity views**: workflows, channels and plugins are read-only views of
  the head, with their definition, history across revisions, a live definition test,
  and the channels/rollouts that reach them. A canary split is drawn per channel.
- **Connections**: what 1.x called connectors — immutable revisions over a provider,
  the deployed revision, settings, secret locators, bindings, dependants, circuit
  breakers, a live probe, and a revision diff.
- **Provider packages**: upload with lint and optional admission, admit, revoke with a
  reason, the admission policy and fingerprint, and a studio that scaffolds, lints and
  packs a package. The studio's tools are read-only-key safe.
- **Runtime capabilities**: edition, channel drivers, provider backends, the
  deployment head and this node's reconciler, as one single source.
- **Admin auth**: `Authorization: Bearer` keys, a key dialog, a probe before any admin
  request, read-only-key awareness throughout the UI, and no admin credential on
  data-plane requests. nginx can inject `ORION_ADMIN_AUTHORIZATION` instead.
- **Cursor pagination** for traces, audit, DLQ and cron occurrences (`Load more`;
  `include_total` where a count is shown).
- A first-run path that teaches compile → apply → converge with copyable `orion-cli`
  commands; one-line notices on 1.x bookmarks that redirect.

### Changed

- The API base is `/api/v2`; the contract, hand-written types and contract test are
  generated from the 2.0 OpenAPI spec.
- Workflows, channels and plugins are addressed by manifest member ids; a trace's
  `channel_id` is that id while `channel_call` names a channel by name.
- The list model is cursor-first; lists the console holds whole page, sort and filter
  in the browser.
- The System Map's lifecycle colouring became **serving** (quarantined / load issue /
  serving); change pins are read from deployment revision diffs.
- `@goplasmatic/dataflow-ui` 4 and `@goplasmatic/datalogic-ui` 5.9 render
  dataflow-rs 4 traces and step policies.

### Removed

- Entity authoring and all 1.x CRUD forms, lifecycle actions (draft / active /
  archived), import/export/validate endpoints, and the unsaved-changes guard.
- Engine reload, models pages, package receipts, and notifications tied to the
  generation reload.
- 1.x connector pages (replaced by connections) and the `/models` and `/packages`
  surfaces; their old URLs redirect with an explanation.
- 1.x-only `/health` detail (`models`, `[packages] apply`) and the `models` runtime
  capability.
- **All 1.x compatibility**: dataflow-rs 3 trace parsing, the `/connectors`, `/models`,
  `/packages`, `/settings` and `*/new`/`*/edit` routes, the retired-route notices, and the
  deprecated `?token=` trace read. A 1.x server is not supported.

### Upgrading

- Point the UI at an Orion 2.0 server. A 1.x server is not supported.
- With `admin_auth.enabled`, each operator enters a key (kept in that tab), or the
  deployment injects one centrally. Prefer a read-only key where the console only
  needs to look.
- Existing bookmarks to removed pages redirect; the deployment history is the new
  record of change.
