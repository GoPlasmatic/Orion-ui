import { useId, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { DEFAULT_AUTH_HEADER, clearAdminKey, setAdminKey, tryAdminKey } from "@/api/auth"
import { useAdminAuth } from "@/hooks/use-admin-auth"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Outcome = "refused" | "unreachable" | null

/**
 * Enter the admin API key this tab sends. The key is probed once before it is
 * held, so a typo is caught here rather than by a page full of failures — and
 * because every refusal counts toward the server's lockout, the dialog sends
 * exactly one request per submit.
 */
export function AdminKeyDialog({ onClose }: { onClose: () => void }) {
  const auth = useAdminAuth()
  const queryClient = useQueryClient()
  const [key, setKey] = useState("")
  const [header, setHeader] = useState(auth.header)
  const [showHeader, setShowHeader] = useState(auth.header !== DEFAULT_AUTH_HEADER)
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const keyId = useId()
  const headerId = useId()

  const submit = async () => {
    if (!key.trim() || pending) return
    setPending(true)
    setOutcome(null)
    const answer = await tryAdminKey(key, header.trim() || DEFAULT_AUTH_HEADER)
    setPending(false)
    if (answer !== "accepted") {
      setOutcome(answer)
      return
    }
    setAdminKey(key, header.trim() || DEFAULT_AUTH_HEADER, true)
    // Everything that failed for want of a key asks again.
    void queryClient.invalidateQueries()
    onClose()
  }

  const signOut = () => {
    clearAdminKey()
    queryClient.clear()
    onClose()
  }

  return (
    <Dialog open onClose={onClose} className="max-w-md" aria-label="Admin API key">
      <DialogHeader>
        <DialogTitle>Admin API key</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <DialogBody className="space-y-4">
          {auth.status === "needed" && (
            <p className="text-sm text-muted-foreground">
              {auth.reason === "refused"
                ? "The server refused the key this tab held. Enter a valid one to continue."
                : "This server requires an admin API key for its admin API and metrics."}
            </p>
          )}
          {auth.status === "accepted" && (
            <p className="text-sm text-muted-foreground">
              This tab holds a key the server accepted
              {auth.access === "read-only" ? ", with read-only access" : ""}. Enter another to replace it.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={keyId}>Key</Label>
            <Input
              id={keyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste a full-access or read-only key"
            />
            <p className="text-xs text-muted-foreground">
              Kept in this tab only, and forgotten when the tab closes.
            </p>
          </div>
          {showHeader ? (
            <div className="space-y-1.5">
              <Label htmlFor={headerId}>Header</Label>
              <Input
                id={headerId}
                spellCheck={false}
                value={header}
                onChange={(e) => setHeader(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The server's <code>admin_auth.header</code>. <code>Authorization</code> sends{" "}
                <code>Bearer &lt;key&gt;</code>; any other header carries the key as is.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => setShowHeader(true)}
            >
              The server uses a different header
            </button>
          )}
          {outcome === "refused" && (
            <Callout variant="destructive">
              The server refused this key. After five refused attempts it refuses every key from this
              address for up to 30 seconds — if you are sure of the key, wait and try again.
            </Callout>
          )}
          {outcome === "unreachable" && (
            <Callout variant="warning">The server did not answer. Check that it is running, then try again.</Callout>
          )}
        </DialogBody>
        <DialogFooter>
          {auth.key && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={signOut}>
              Forget key
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!key.trim() || pending}>
            {pending ? "Checking…" : "Use key"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
