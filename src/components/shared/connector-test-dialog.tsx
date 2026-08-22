import { useTestConnector } from "@/hooks/use-connectors"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog"
import { Callout } from "@/components/ui/callout"
import { MinusCircle } from "lucide-react"
import type { Connector, ProbeResult } from "@/api/types"

/**
 * The `http` probe issues one *genuine* request to the configured URL with the
 * connector's real credentials — that is the point, since a wrong bearer token
 * is invisible until traffic hits it. Anything with a side effect deserves a
 * confirmation, so the probe runs on click rather than on open.
 */
const HAS_SIDE_EFFECT: Partial<Record<Connector["connector_type"], string>> = {
  http: "Sends one real GET to the configured URL, with this connector's credentials.",
  smtp: "Opens a real connection and runs EHLO/TLS/auth. No mail is sent.",
}

export function ConnectorTestDialog({
  connector,
  onClose,
}: {
  connector: Connector
  onClose: () => void
}) {
  const test = useTestConnector()
  const warning = HAS_SIDE_EFFECT[connector.connector_type]

  return (
    <Dialog open onClose={onClose} aria-label="Test connector">
      <DialogHeader>
        <DialogTitle>Test {connector.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted-foreground">
          Probes the stored connector with its <code className="font-mono">env://</code>{" "}
          references resolved — not the loaded registry entry, so this still works on a connector
          that failed to load.
        </p>
        {warning && (
          <Callout variant="warning" icon={false} className="px-3 py-2 text-xs">
            {warning}
          </Callout>
        )}

        {test.isError && (
          <Callout variant="destructive">
            {test.error instanceof Error ? test.error.message : "Probe failed"}
          </Callout>
        )}

        {test.data && <ProbeOutcome result={test.data} />}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={test.isPending}>
          Close
        </Button>
        <Button onClick={() => test.mutate(connector.id)} disabled={test.isPending}>
          {test.isPending ? "Probing..." : test.data ? "Probe again" : "Run probe"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function ProbeOutcome({ result }: { result: ProbeResult }) {
  // No probe exists for es, kafka, or a MongoDB-backed db connector. That is a
  // permanent capability gap, not an outage — never render it as a failure.
  if (!result.supported) {
    return (
      <div className="flex items-start gap-2 rounded-md border p-3">
        <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">No probe available</p>
          <p className="text-xs text-muted-foreground">
            Orion has no reachability probe for this connector kind. Its health shows up when a
            workflow uses it, or via <code className="font-mono">orion-server test-connectivity</code>{" "}
            for Kafka brokers.
          </p>
        </div>
      </div>
    )
  }

  if (result.reachable) {
    return (
      <Callout variant="success">
        <div className="space-y-1 text-sm">
          <p className="font-medium">Reachable</p>
          <p className="text-xs text-muted-foreground">
            Probe: <code className="font-mono">{result.probe}</code>
          </p>
        </div>
      </Callout>
    )
  }

  return (
    <Callout variant="destructive">
      <div className="space-y-1 text-sm">
        <p className="font-medium">Not reachable</p>
        {result.error && (
          <pre className="whitespace-pre-wrap font-mono text-xs">
            {result.error}
          </pre>
        )}
        <p className="text-xs text-muted-foreground">
          Probe: <code className="font-mono">{result.probe}</code>. A 401 or 403 counts as not
          reachable — the host answered, but the credentials are wrong.
        </p>
      </div>
    </Callout>
  )
}
