/**
 * Render guard for the function catalogue page.
 *
 * Orion 1.2 widened `GET /admin/functions` from the input-schema registry to
 * every valid function name, and the nine engine built-ins it added **omit**
 * `input_fields` — absence being the honest encoding of "declares no input
 * schema". The page previously read `fn.input_fields.length` unconditionally,
 * which throws on exactly those rows: the catalogue endpoint would have taken
 * the whole page down.
 *
 * So the case that matters here is the row with no `input_fields` at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DensityProvider } from "@/lib/density-provider"
import { ThemeProvider } from "@/lib/theme-provider"
import type { FunctionSchema } from "@/api/types"

const functionRows: FunctionSchema[] = [
  {
    name: "http_call",
    description: "Call an HTTP endpoint through a connector.",
    category: "connector",
    source: "orion",
    // 1.6: a retry's safety depends on the task's own `method`.
    retry_safety: { kind: "depends_on", input: "method" },
    input_fields: [
      {
        name: "connector",
        description: "Name of the http connector to call through.",
        kind: "string",
        required: true,
        resolvable: false,
        secret_at: [],
        alias: null,
      },
    ],
  },
  {
    // 1.3: `secret_at` names where a field takes `{"secret": "name"}` — the
    // value itself for `key`, each element's `key` for `keys`.
    name: "jwt_verify",
    description: "Verify a JWT against static keys or a JWKS.",
    category: "utility",
    source: "orion",
    retry_safety: { kind: "read" },
    input_fields: [
      {
        name: "token",
        description: "The compact JWS to verify.",
        kind: "string",
        required: true,
        resolvable: true,
        secret_at: [],
        alias: null,
      },
      {
        name: "keys",
        description: "Static verification keys.",
        kind: "array",
        required: false,
        resolvable: false,
        secret_at: ["[].key"],
        alias: null,
      },
    ],
  },
  {
    // An engine built-in: no `input_fields` key at all.
    name: "map",
    description: "Copy and transform values between the run's documents.",
    category: "data",
    source: "engine",
    retry_safety: { kind: "pure" },
  },
  {
    // The alias row — `validation` carries `validate` rather than appearing twice.
    name: "validation",
    description: "Check the message against a rule set.",
    category: "data",
    source: "engine",
    aliases: ["validate"],
    retry_safety: { kind: "pure" },
  },
  {
    // An Orion handler that genuinely takes nothing, which must read
    // differently from the engine rows above.
    name: "log",
    description: "Write a line to the run log.",
    category: "utility",
    source: "orion",
    retry_safety: { kind: "pure" },
    input_fields: [],
  },
  {
    // 1.6: a function an active plugin declares. Its field table comes from
    // the manifest, and the row names the version and digest serving it.
    name: "acme.codec.parse",
    description: "Parse a fixed-width record into JSON.",
    category: "transform",
    source: "plugin",
    retry_safety: { kind: "pure" },
    plugin: { id: "acme.codec", version: 2, digest: "sha256:abc", abi: "orion:plugin@1.0.0" },
    input_fields: [
      {
        name: "record",
        description: "The raw record.",
        kind: "string",
        required: true,
        resolvable: false,
        secret_at: [],
        // 1.5: the value is JSONLogic, evaluated per message.
        template_at: [""],
        alias: null,
      },
    ],
  },
  {
    name: "send_email",
    description: "Send an email through an smtp connector.",
    category: "connector",
    source: "orion",
    retry_safety: { kind: "unsafe_write" },
    input_fields: [
      {
        name: "connector",
        description: "Name of the smtp connector.",
        kind: "string",
        required: true,
        resolvable: false,
        secret_at: [],
        template_at: [],
        alias: null,
      },
    ],
  },
]

vi.mock("@/api/functions", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/functions")>()
  return { ...mod, functionsApi: { ...mod.functionsApi, list: async () => functionRows } }
})

import { FunctionsPage } from "@/pages/functions"

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThemeProvider>
          <DensityProvider>
            <FunctionsPage />
          </DensityProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(cleanup)

describe("functions page", () => {
  it("renders a row whose input_fields is absent without throwing", async () => {
    renderPage()
    expect(await screen.findByText("map")).toBeInTheDocument()
    expect(screen.getByText("http_call")).toBeInTheDocument()
    expect(screen.getByText("Name of the http connector to call through.")).toBeInTheDocument()
  })

  it("distinguishes 'no declared schema' from 'takes no input'", async () => {
    renderPage()
    await screen.findByText("map")
    // The engine rows say why there is no field list...
    expect(screen.getAllByText(/declares no input schema/).length).toBeGreaterThan(0)
    // ...while an Orion handler with an empty list says it takes nothing.
    expect(screen.getByText("Takes no input fields.")).toBeInTheDocument()
  })

  it("surfaces aliases", async () => {
    renderPage()
    await screen.findByText("validation")
    expect(screen.getByText("alias: validate")).toBeInTheDocument()
  })

  it("marks the fields that take a secret reference (1.3)", async () => {
    renderPage()
    await screen.findByText("jwt_verify")
    // `keys` reads key material at `[].key`; `token` folds vars but holds no secret.
    const secret = screen.getAllByText("secret")
    expect(secret).toHaveLength(1)
    expect(secret[0]).toHaveAttribute("title", expect.stringContaining("[].key"))
    expect(screen.getAllByText("resolvable")).toHaveLength(1)
  })

  it("counts the three sources of the catalogue", async () => {
    renderPage()
    await screen.findByText("map")
    expect(screen.getByText("7 functions")).toBeInTheDocument()
  })

  it("filters to engine built-ins", async () => {
    const { container } = renderPage()
    await screen.findByText("http_call")
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by source"]')
    expect(select).not.toBeNull()
    select!.value = "engine"
    select!.dispatchEvent(new Event("change", { bubbles: true }))
    expect(await screen.findByText("2 of 7")).toBeInTheDocument()
    expect(screen.queryByText("http_call")).not.toBeInTheDocument()
  })

  it("says what a retry costs, naming the deciding input (1.6)", async () => {
    renderPage()
    await screen.findByText("http_call")
    // `depends_on` carries the input to look at rather than a boolean that
    // would be wrong half the time.
    expect(screen.getByText("method", { selector: "code" })).toBeInTheDocument()
    expect(screen.getByText("retry: unsafe to retry")).toBeInTheDocument()
    expect(screen.getAllByText("retry: pure").length).toBeGreaterThan(0)
  })

  it("links a plugin function to the plugin serving it (1.6)", async () => {
    renderPage()
    await screen.findByText("acme.codec.parse")
    const link = screen.getByText("acme.codec v2")
    expect(link.closest("a")).toHaveAttribute("href", "/plugins/acme.codec")
    // A `template_at` field is an expression, not a literal of its kind.
    expect(screen.getByText("expression")).toBeInTheDocument()
  })

  it("filters to plugin functions", async () => {
    const { container } = renderPage()
    await screen.findByText("http_call")
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by source"]')
    select!.value = "plugin"
    select!.dispatchEvent(new Event("change", { bubbles: true }))
    expect(await screen.findByText("1 of 7")).toBeInTheDocument()
    expect(screen.queryByText("http_call")).not.toBeInTheDocument()
  })
})
