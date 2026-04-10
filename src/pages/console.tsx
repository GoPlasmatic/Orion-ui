import { useState } from "react"
import { dataApi } from "@/api/data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { JsonViewer } from "@/components/shared/json-viewer"
import { Send } from "lucide-react"

export function ConsolePage() {
  const [channel, setChannel] = useState("")
  const [payload, setPayload] = useState('{\n  \n}')
  const [sync, setSync] = useState(true)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<object | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    setError(null)
    setResult(null)

    if (!channel.trim()) {
      setError("Channel name is required")
      return
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(payload)
    } catch {
      setError("Invalid JSON payload")
      return
    }

    setLoading(true)
    try {
      const res = sync
        ? await dataApi.processSync(channel, { data })
        : await dataApi.processAsync(channel, { data })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Data Console" description="Send test requests to channels" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Channel</label>
              <Input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="e.g. orders, payments"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">JSON Payload</label>
              <Textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder='{ "key": "value" }'
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sync}
                  onChange={(e) => setSync(e.target.checked)}
                  className="rounded"
                />
                Synchronous
              </label>
              <Badge variant="outline">{sync ? "Sync" : "Async"}</Badge>
            </div>

            <Button onClick={handleSend} disabled={loading} className="w-full">
              <Send className="h-4 w-4" />
              {loading ? "Sending..." : "Send"}
            </Button>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Response</CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <JsonViewer data={result} maxHeight="500px" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Send a request to see the response here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
