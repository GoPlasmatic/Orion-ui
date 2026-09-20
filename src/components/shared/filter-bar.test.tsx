/**
 * The free-text list filter.
 *
 * Every commit is a URL navigation *and* a list request, and these filters are
 * exact matches server-side — so an uncontrolled version spent one request per
 * keystroke and four out of five of them could only come back empty. What is
 * typed stays local until the typing pauses; what is committed stays
 * authoritative, so a clear or a deep link replaces the text rather than
 * fighting it.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"
import { FilterTextInput, UnknownOption } from "@/components/shared/filter-bar"

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("Filter by tag"), { target: { value } })

const box = () => screen.getByLabelText("Filter by tag") as HTMLInputElement

describe("FilterTextInput", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("commits once, after the typing stops", () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<FilterTextInput value="" onChange={onChange} ariaLabel="Filter by tag" />)

    for (const text of ["a", "al", "alp", "alph", "alpha"]) type(text)
    expect(box().value).toBe("alpha")
    expect(onChange, "nothing is committed while the keys are still coming").not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(400))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("alpha")
  })

  it("commits immediately on Enter and on leaving the field", () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<FilterTextInput value="" onChange={onChange} ariaLabel="Filter by tag" />)

    type("alpha")
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("alpha")

    onChange.mockClear()
    type("beta")
    fireEvent.blur(box())
    expect(onChange).toHaveBeenCalledWith("beta")
  })

  it("follows the committed value when it changes elsewhere", () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { rerender } = render(
      <FilterTextInput value="alpha" onChange={onChange} ariaLabel="Filter by tag" />,
    )
    expect(box().value).toBe("alpha")

    // Half-typed, then "Clear filters" empties the filter from outside.
    type("alph")
    rerender(<FilterTextInput value="" onChange={onChange} ariaLabel="Filter by tag" />)
    expect(box().value).toBe("")

    // The abandoned text must not land on top of the clear a moment later.
    act(() => void vi.advanceTimersByTime(400))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("UnknownOption", () => {
  afterEach(cleanup)

  it("shows a value the dropdown does not list, and nothing otherwise", () => {
    const { rerender } = render(
      <select aria-label="mode" value="grpc" onChange={() => {}}>
        <UnknownOption value="grpc" options={["sync", "async"]} />
        <option value="sync">sync</option>
      </select>,
    )
    expect(screen.getByRole("option", { name: "grpc" })).toBeInTheDocument()

    rerender(
      <select aria-label="mode" value="sync" onChange={() => {}}>
        <UnknownOption value="sync" options={["sync", "async"]} />
        <option value="sync">sync</option>
      </select>,
    )
    expect(screen.getAllByRole("option")).toHaveLength(1)
  })
})
