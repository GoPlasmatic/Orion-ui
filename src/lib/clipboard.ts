import { toast } from "sonner"

/**
 * Copy to the clipboard and say so, one way: a success toast naming what was
 * copied, an error toast when the browser refuses (no permission, an insecure
 * origin, no clipboard at all). Returns whether it worked, for a button that
 * wants to show a check mark.
 */
export async function copyText(text: string, what: string, description?: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error("No clipboard")
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`, description ? { description } : undefined)
    return true
  } catch {
    toast.error(`Could not copy the ${what.toLowerCase()}`)
    return false
  }
}
