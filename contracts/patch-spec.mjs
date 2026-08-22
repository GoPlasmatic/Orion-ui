#!/usr/bin/env node
/**
 * Patch the vendored Orion OpenAPI spec.
 *
 * Run this after copying a new spec in:
 *
 *   cp ../Orion/docs/openapi.json contracts/openapi.json
 *   node contracts/patch-spec.mjs
 *   npm run generate:api
 *
 * Idempotent. Exits 0 and reports "nothing to patch" once upstream ships the
 * fix, at which point this file and its npm hook can be deleted.
 *
 * ---------------------------------------------------------------------------
 * PATCH 1 — missing `OnConflict` / `ReloadMode` component schemas (Orion 1.1.0)
 *
 * Six query parameters `$ref` these two components, but neither is registered
 * in `components.schemas`, so the published spec does not resolve and
 * `openapi-typescript` refuses to generate:
 *
 *   POST  /admin/{channels,connectors,workflows}/import  ?on_conflict  -> OnConflict
 *   PATCH /admin/{channels,workflows}/{id}/status        ?reload       -> ReloadMode
 *   PATCH /admin/workflows/{id}/rollout                  ?reload       -> ReloadMode
 *
 * Both enums derive `utoipa::ToSchema` but are never added to the components
 * registry. Values below are transcribed verbatim from the Rust source, which
 * is authoritative:
 *
 *   OnConflict  crates/orion-api/src/import.rs:12          #[serde(rename_all = "snake_case")]
 *   ReloadMode  crates/orion-server/src/server/routes/admin/mod.rs:422
 *                                                          #[serde(rename_all = "lowercase")]
 *
 * Reported upstream: see contracts/PATCHES.md.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const specPath = join(dirname(fileURLToPath(import.meta.url)), "openapi.json")
const spec = JSON.parse(readFileSync(specPath, "utf8"))
const schemas = spec.components?.schemas
if (!schemas) {
  console.error("✘ contracts/openapi.json has no components.schemas — wrong file?")
  process.exit(1)
}

const MISSING = {
  OnConflict: {
    type: "string",
    enum: ["fail", "skip", "new_version"],
    default: "fail",
    description:
      "How an `/import` treats an item whose conflict key is already stored.\n" +
      "`fail` refuses the item (default), `skip` leaves the stored entity alone,\n" +
      "`new_version` upserts: an existing draft is updated in place, an active\n" +
      "entity whose content differs gets a new draft version, and a\n" +
      "content-identical item is reported `unchanged` and writes nothing.",
  },
  ReloadMode: {
    type: "string",
    enum: ["now", "defer"],
    default: "now",
    description:
      "When an active-set mutation rebuilds the engine.\n" +
      "`now` rebuilds as part of this request (default). `defer` commits the row\n" +
      "but leaves the running engine — and every peer, in cluster mode — on the\n" +
      "previous configuration until `POST /api/v1/admin/engine/reload`.",
  },
}

const added = []
for (const [name, schema] of Object.entries(MISSING)) {
  if (schemas[name]) continue
  schemas[name] = schema
  added.push(name)
}

if (added.length === 0) {
  console.log("✔ nothing to patch — upstream defines every referenced component.")
  console.log("  If this stays true on the next vendor, delete contracts/patch-spec.mjs.")
  process.exit(0)
}

// Keep components.schemas alphabetically ordered so the diff of a re-vendor
// stays readable rather than showing the appended keys as a churn block.
spec.components.schemas = Object.fromEntries(
  Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))
)

writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n")
console.log(`✔ patched contracts/openapi.json — added ${added.join(", ")}`)
