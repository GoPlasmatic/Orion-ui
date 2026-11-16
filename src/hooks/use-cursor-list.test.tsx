import { describe, it, expect } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { Page } from "@/api/types"
import { useCursorList } from "@/hooks/use-cursor-list"
import { LoadMoreFooter } from "@/components/shared/load-more"

const PAGES: Record<string, Page<number>> = {
  first: { data: [5, 4], limit: 2, next_cursor: "c2", total: 5 },
  c2: { data: [3, 2], limit: 2, next_cursor: "c3" },
  c3: { data: [1], limit: 2, next_cursor: null },
}

function List({ requested }: { requested: (string | undefined)[] }) {
  const list = useCursorList(["numbers"], async (cursor) => {
    requested.push(cursor)
    return PAGES[cursor ?? "first"]
  })
  return (
    <div>
      <p data-testid="rows">{list.rows.join(",")}</p>
      <LoadMoreFooter
        count={list.rows.length}
        total={list.total}
        hasMore={list.hasMore}
        pending={list.isFetchingMore}
        onLoadMore={list.loadMore}
        noun="number"
      />
    </div>
  )
}

describe("useCursorList + LoadMoreFooter", () => {
  it("accumulates pages by cursor until the server stops handing one out", async () => {
    const requested: (string | undefined)[] = []
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <List requested={requested} />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toBe("5,4"))
    expect(screen.getByText("2 of 5 numbers")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toBe("5,4,3,2"))
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toBe("5,4,3,2,1"))

    expect(requested).toEqual([undefined, "c2", "c3"])
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument()
  })

  it("says what is loaded when the server did not count", () => {
    render(<LoadMoreFooter count={50} hasMore pending={false} onLoadMore={() => {}} noun="trace" />)
    expect(screen.getByText("50 traces loaded")).toBeInTheDocument()
  })
})
