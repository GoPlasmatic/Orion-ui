/**
 * The list view state every page keeps in the URL: which values a filter
 * accepts, whether anything is narrowing the list, and the way back out.
 *
 * The first of those is not cosmetic. A value outside a closed enum — a stale
 * link, a typo — used to reach the server, which answers it with nothing,
 * while the dropdown went on reading "All statuses": an empty list with no
 * visible cause. It now reads as unset, so the control, the request and the
 * rows agree.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router"
import { ENTITY_STATUSES } from "@/api/types"
import { useListState } from "@/lib/use-list-state"

const KEYS = ["status", "tag"] as const
const SORT_FIELDS = { name: "name" }

function Probe() {
  const { filters, hasFilters, offset, sortQuery, update, clear } = useListState(
    KEYS,
    SORT_FIELDS,
    { values: { status: ENTITY_STATUSES } },
  )
  const { search } = useLocation()
  return (
    <div>
      <span data-testid="search">{search}</span>
      <span data-testid="status">{filters.status}</span>
      <span data-testid="tag">{filters.tag}</span>
      <span data-testid="has-filters">{String(hasFilters)}</span>
      <span data-testid="offset">{offset}</span>
      <span data-testid="sort-by">{sortQuery.sort_by ?? ""}</span>
      <button onClick={() => update({ status: "draft" })}>set status</button>
      <button onClick={clear}>clear</button>
    </div>
  )
}

const mount = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>,
  )

const read = (id: string) => screen.getByTestId(id).textContent
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }))

describe("useListState", () => {
  afterEach(cleanup)

  it("reads a declared value through", () => {
    mount("/channels?status=archived")
    expect(read("status")).toBe("archived")
    expect(read("has-filters")).toBe("true")
  })

  it("reads a value outside the declared set as unset", () => {
    mount("/channels?status=bogus")
    expect(read("status")).toBe("")
    // Nothing is narrowing the list, so the page shows its first-run state
    // rather than "no matches", and the request carries no status at all.
    expect(read("has-filters")).toBe("false")
  })

  it("leaves a free-text filter alone", () => {
    mount("/channels?tag=anything-at-all")
    expect(read("tag")).toBe("anything-at-all")
    expect(read("has-filters")).toBe("true")
  })

  it("re-anchors to the first page when a filter changes", () => {
    mount("/channels?status=active&offset=40")
    expect(read("offset")).toBe("40")
    click("set status")
    expect(read("offset")).toBe("0")
    expect(read("search")).toContain("status=draft")
    expect(read("search")).not.toContain("offset")
  })

  it("clears every filter and keeps the sort", () => {
    mount("/channels?status=active&tag=payments&offset=40&sort=name&order=asc")
    expect(read("has-filters")).toBe("true")
    click("clear")
    expect(read("has-filters")).toBe("false")
    expect(read("offset")).toBe("0")
    expect(read("sort-by")).toBe("name")
    expect(read("search")).toBe("?sort=name&order=asc")
  })

  it("ignores a sort field the server does not serve", () => {
    mount("/channels?sort=nonsense&order=asc")
    expect(read("sort-by")).toBe("")
  })
})
