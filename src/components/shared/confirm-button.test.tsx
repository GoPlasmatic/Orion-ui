/**
 * ConfirmButton: the trigger opens a dialog, the action runs only on confirm,
 * the caller decides when the dialog closes, and a pending action disables
 * the confirm so a second click cannot fire it twice.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { ConfirmButton } from "./confirm-button"

afterEach(cleanup)

const dialog = { title: "Invalidate orders?", description: "Every entry stops matching." }

describe("ConfirmButton", () => {
  it("runs the action only once confirmed, and closes when told", () => {
    const onConfirm = vi.fn((close: () => void) => close())
    render(<ConfirmButton label="Invalidate" dialog={dialog} onConfirm={onConfirm} />)
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Invalidate" }))
    expect(screen.getByRole("dialog", { name: dialog.title })).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    // The dialog's confirm repeats the trigger's label.
    const buttons = screen.getAllByRole("button", { name: "Invalidate" })
    fireEvent.click(buttons[buttons.length - 1])
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("cancel closes without running the action", () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Invalidate" dialog={dialog} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole("button", { name: "Invalidate" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("disables the confirm while the action is pending", () => {
    const onConfirm = vi.fn()
    const { rerender } = render(
      <ConfirmButton label="Invalidate" pendingLabel="Invalidating..." dialog={dialog} onConfirm={onConfirm} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Invalidate" }))
    rerender(
      <ConfirmButton label="Invalidate" pendingLabel="Invalidating..." pending dialog={dialog} onConfirm={onConfirm} />
    )
    expect(screen.getByRole("button", { name: "Invalidating..." })).toBeDisabled()
    const confirm = screen.getByRole("button", { name: "Invalidate" })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("keeps a click from reaching a row that opens on click", () => {
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <ConfirmButton label="Cancel run" dialog={dialog} onConfirm={(close) => close()} />
      </div>
    )
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onRow).not.toHaveBeenCalled()
  })
})
