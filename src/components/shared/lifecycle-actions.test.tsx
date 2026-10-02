/**
 * Delete is the one lifecycle action that cannot be undone, so it is never the
 * header's loudest button: it sits in the overflow menu and is confirmed by
 * typing the entity's name — by default the `DetailHeader` title, so every
 * detail page gets the guard without passing a name.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { LifecycleActions } from "./lifecycle-actions"
import { DetailHeader } from "./detail-header"

afterEach(cleanup)

function renderHeader(props: Partial<React.ComponentProps<typeof LifecycleActions>> = {}) {
  const onDelete = vi.fn()
  render(
    <MemoryRouter>
      <DetailHeader
        breadcrumbs={[{ label: "Channels", to: "/channels" }, { label: "orders-get" }]}
        title="orders-get"
        actions={
          <LifecycleActions
            status="active"
            onActivate={vi.fn()}
            onArchive={vi.fn()}
            onNewVersion={vi.fn()}
            onDelete={onDelete}
            {...props}
          />
        }
      />
    </MemoryRouter>
  )
  return { onDelete }
}

describe("LifecycleActions", () => {
  it("shows no Delete button until the overflow menu is opened", () => {
    renderHeader()
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument()
  })

  it("leads with New Version on an active entity and Activate on a draft", () => {
    renderHeader()
    expect(screen.getByRole("button", { name: /new version/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^activate$/i })).toBeNull()
    cleanup()
    renderHeader({ status: "draft" })
    expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /new version/i })).toBeNull()
  })

  it("deletes only once the entity's name is typed", () => {
    const { onDelete } = renderHeader()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }))

    const dialog = screen.getByRole("dialog", { name: "Delete orders-get?" })
    const confirm = screen.getByRole("button", { name: "Delete" })
    expect(dialog).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    const input = screen.getByLabelText(/type .* to confirm/i)
    fireEvent.change(input, { target: { value: "orders-ge" } })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "orders-get" } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("prefers an explicit entity name over the header title", () => {
    renderHeader({ entityName: "v2-orders" })
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }))
    expect(screen.getByRole("dialog", { name: "Delete v2-orders?" })).toBeInTheDocument()
  })
})
