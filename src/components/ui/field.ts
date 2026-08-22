/**
 * Shared chrome for the text-entry primitives (Input, Textarea, Select) so their
 * border, focus ring and invalid state stay identical. Imported by those three
 * only — compose a field from them rather than re-deriving these classes.
 */
export const fieldBase = [
  "w-full rounded-md border border-input bg-card text-foreground shadow-xs",
  "transition-[color,border-color,box-shadow] duration-150",
  "placeholder:text-muted-foreground/80",
  "hover:border-border-strong",
  "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35",
  "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/35",
  "disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60",
].join(" ")
