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
    input_fields: [
      {
        name: "connector",
        description: "Name of the http connector to call through.",
        kind: "string",
        required: true,
      },
    ],
  },
  {
    // An engine built-in: no `input_fields` key at all.
    name: "map",
    description: "Copy and transform values between the run's documents.",
    category: "data",
    source: "engine",
  },
  {
    // The alias row — `validation` carries `validate` rather than appearing twice.
    name: "validation",
    description: "Check the message against a rule set.",
    category: "data",
    source: "engine",
    aliases: ["validate"],
  },
  {
    // An Orion handler that genuinely takes nothing, which must read
    // differently from the engine rows above.
    name: "log",
    description: "Write a line to the run log.",
    category: "utility",
    source: "orion",
    input_fields: [],
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

  it("counts the two halves of the catalogue", async () => {
    renderPage()
    await screen.findByText("map")
    expect(screen.getByText("4 functions")).toBeInTheDocument()
  })

  it("filters to engine built-ins", async () => {
    const { container } = renderPage()
    await screen.findByText("http_call")
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by source"]')
    expect(select).not.toBeNull()
    select!.value = "engine"
    select!.dispatchEvent(new Event("change", { bubbles: true }))
    expect(await screen.findByText("2 of 4")).toBeInTheDocument()
    expect(screen.queryByText("http_call")).not.toBeInTheDocument()
  })
})
