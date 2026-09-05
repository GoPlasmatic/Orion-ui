# Local patches to the vendored spec

`contracts/openapi.json` is a **vendored copy** of the Orion server's published
spec (`Orion/docs/openapi.json`, also served at `/api/v1/openapi.json` when the
server does not run with `environment = "production"`).

It is not edited by hand. Where the published spec is defective, the fix lives
in `contracts/patch-spec.mjs` so it can be re-applied deterministically after
every re-vendor.

## Vendoring procedure

```bash
cp ../Orion/docs/openapi.json contracts/openapi.json
node contracts/patch-spec.mjs      # re-apply local patches
npm run generate:api               # regenerate src/api/schema.d.ts
npm test                           # contract.test.ts
```

`patch-spec.mjs` is idempotent and reports `nothing to patch` when upstream has
fixed everything. When that happens, delete both this file and the script.

---

## Patch 1 — missing `OnConflict` / `ReloadMode` components

**Server version affected:** 1.1.0 — still present in 1.6.0
**Status:** open upstream — not yet reported

Eight query parameters (six before 1.6) `$ref` these two schema components, but neither is
registered in `components.schemas`, so the published spec does not resolve.
`openapi-typescript` fails hard:

```
✘ Can't resolve $ref at #/paths/~1api~1v1~1admin~1workflows~1{id}~1status/patch/parameters/2/schema
Error: Can't resolve $ref …
```

Affected operations:

| Operation | Parameter | Unresolved `$ref` |
|---|---|---|
| `POST /admin/channels/import` | `on_conflict` | `OnConflict` |
| `POST /admin/connectors/import` | `on_conflict` | `OnConflict` |
| `POST /admin/workflows/import` | `on_conflict` | `OnConflict` |
| `PATCH /admin/channels/{id}/status` | `reload` | `ReloadMode` |
| `PATCH /admin/workflows/{id}/status` | `reload` | `ReloadMode` |
| `PATCH /admin/workflows/{id}/rollout` | `reload` | `ReloadMode` |
| `POST /admin/plugins/import` (1.6) | `on_conflict` | `OnConflict` |
| `PATCH /admin/plugins/{id}/status` (1.6) | `reload` | `ReloadMode` |

**Root cause.** Both enums derive `utoipa::ToSchema` but are never added to the
components registry, so `utoipa` emits the `$ref` without emitting the
definition.

**Values** are transcribed verbatim from the Rust source, which is
authoritative:

| Enum | Source | Serde | Values |
|---|---|---|---|
| `OnConflict` | `crates/orion-api/src/import.rs:12` | `snake_case` | `fail` (default), `skip`, `new_version` |
| `ReloadMode` | `crates/orion-server/src/server/routes/admin/mod.rs:422` | `lowercase` | `now` (default), `defer` |

**Upstream fix** would be to register both in the `utoipa::OpenApi` derive's
`components(schemas(…))` list. Once a server release ships that, re-vendor and
the patch becomes a no-op.

> The patch also re-sorts `components.schemas` alphabetically so a future
> re-vendor produces a readable diff rather than showing the injected keys as a
> churn block. If upstream ordering ever matters, drop that step.
