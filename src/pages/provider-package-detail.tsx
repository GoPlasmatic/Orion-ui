import { useMemo, useState } from "react"
import { Link, useParams } from "react-router"
import { useAdmitPackage, useProviderPackage, useRevokePackage } from "@/hooks/use-provider-packages"
import { useConnections } from "@/hooks/use-connections"
import { useRuntimeCapabilities } from "@/hooks/use-runtime-capabilities"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { useUrlFilters } from "@/lib/use-url-filters"
import { shortDigest } from "@/lib/deployment-diff"
import { EDITION_TIERS } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DetailHeader, DetailSkeleton } from "@/components/shared/detail-header"
import { ErrorState } from "@/components/shared/error-state"
import { Fact } from "@/components/shared/fact"
import { JsonViewer } from "@/components/shared/json-viewer"
import { PackageStateBadge, TierBadge } from "@/components/packages/package-badges"
import { formatBytes } from "@/lib/utils"
import { Ban, ShieldCheck } from "lucide-react"

const TABS = ["overview", "operations", "files", "manifest"] as const
const URL_KEYS = ["tab"] as const

interface Operation {
  name: string
  effect?: string
  retry?: string
  input_schema?: string
  output_schema?: string
}

/** `connector.json`'s operations, as rows. */
function operationsOf(manifest: Record<string, unknown>): Operation[] {
  const ops = manifest.operations
  if (!ops || typeof ops !== "object") return []
  return Object.entries(ops as Record<string, Record<string, unknown>>)
    .map(([name, o]) => ({
      name,
      effect: typeof o?.effect === "string" ? o.effect : undefined,
      retry: typeof o?.retry === "string" ? o.retry : undefined,
      input_schema: typeof o?.input_schema === "string" ? o.input_schema : undefined,
      output_schema: typeof o?.output_schema === "string" ? o.output_schema : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One provider package: what it is (publisher, provider, version,
 * implementation, tier), its admission under this node's policy, the
 * operations a `connector_call` may name, its files, and the connections that
 * name it. Admit and revoke need a full-access key; revoking warns when a
 * deployed connection would lose its provider.
 */
export function ProviderPackageDetailPage() {
  const { digest = "" } = useParams<{ digest: string }>()
  const { values, set } = useUrlFilters(URL_KEYS)
  const tab = (TABS as readonly string[]).includes(values.tab) ? values.tab : "overview"
  const { data, isLoading, error, refetch } = useProviderPackage(digest)
  const connections = useConnections()
  const runtime = useRuntimeCapabilities()
  const canMutate = useCanMutate()
  const admit = useAdmitPackage()
  const [revoking, setRevoking] = useState(false)

  const users = useMemo(
    () =>
      connections.data
        .map((g) => ({ group: g, revisions: g.revisions.filter((r) => r.provider_digest === digest) }))
        .filter((u) => u.revisions.length > 0),
    [connections.data, digest],
  )
  const deployedUsers = users.filter((u) => u.group.deployed?.provider_digest === digest)

  if (isLoading) return <DetailSkeleton />
  if (error || !data) {
    return (
      <ErrorState
        title="Failed to load the provider package"
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/provider-packages", label: "Back to Provider Packages" }}
      />
    )
  }

  const pkg = data.package
  const edition = runtime.data?.edition
  const aboveEdition = !!edition && EDITION_TIERS.indexOf(pkg.tier) > EDITION_TIERS.indexOf(edition)
  const operations = operationsOf(pkg.manifest)
  const files = pkg.inventory?.files ?? []
  const dependencies = Array.isArray(pkg.manifest.dependencies) ? (pkg.manifest.dependencies as unknown[]) : []
  const admitBlocked = !canMutate
    ? READ_ONLY_REASON
    : aboveEdition
      ? `A ${pkg.tier} package needs Orion ${pkg.tier}; this node is ${edition}`
      : undefined

  return (
    <div className="space-y-6">
      <DetailHeader
        breadcrumbs={[{ label: "Provider Packages", to: "/provider-packages" }, { label: pkg.provider_id }]}
        title={pkg.provider_id}
        titleClassName="font-mono"
        badges={
          <>
            <Badge variant="outline" className="font-mono">
              {pkg.version}
            </Badge>
            <PackageStateBadge pkg={pkg} />
          </>
        }
        meta={
          <p className="text-sm text-muted-foreground">
            by <span className="font-mono">{pkg.publisher}</span> · {pkg.implementation} ·{" "}
            <span className="font-mono" title={pkg.digest}>
              {shortDigest(pkg.digest)}
            </span>
          </p>
        }
        actions={
          <>
            {!pkg.admitted && !pkg.revoked && (
              <Button
                onClick={() => admit.mutate({ digest: pkg.digest })}
                disabled={admit.isPending || !!admitBlocked}
                title={admitBlocked ?? "Admit under this node's admission policy"}
              >
                <ShieldCheck className="h-4 w-4" /> {admit.isPending ? "Admitting…" : "Admit"}
              </Button>
            )}
            {pkg.admitted && !pkg.revoked && (
              <Button
                variant="outline"
                onClick={() => setRevoking(true)}
                disabled={!canMutate}
                title={canMutate ? "Revoke: no connection over it may be planned again" : READ_ONLY_REASON}
              >
                <Ban className="h-4 w-4" /> Revoke
              </Button>
            )}
          </>
        }
      />

      {pkg.revoked && (
        <Callout variant="destructive">
          Revoked. No deployment naming a connection over this package can be planned or applied, and its calls are
          refused at dispatch.
        </Callout>
      )}

      <Tabs defaultValue="overview" value={tab} onValueChange={(v) => set({ tab: v === "overview" ? "" : v })}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="operations">Operations ({operations.length})</TabsTrigger>
          <TabsTrigger value="files">Files ({files.length})</TabsTrigger>
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Package</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Fact label="Publisher">{pkg.publisher}</Fact>
                  <Fact label="Version">{pkg.version}</Fact>
                  <Fact label="Implementation" mono={false}>
                    {pkg.implementation}
                  </Fact>
                  <Fact label="Tier" mono={false}>
                    <TierBadge tier={pkg.tier} edition={edition} />
                  </Fact>
                  <Fact label="Artifact" mono={false}>
                    {pkg.artifact_state}
                  </Fact>
                  <Fact label="Dependencies" mono={false}>
                    {dependencies.length === 0 ? "none" : dependencies.length}
                  </Fact>
                  <Fact label="Digest" wide title={pkg.digest}>
                    {pkg.digest}
                  </Fact>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Admission</CardTitle>
              </CardHeader>
              <CardContent>
                {data.admission ? (
                  <dl className="grid grid-cols-1 gap-y-3">
                    <Fact label="Policy">{data.admission.policy_id}</Fact>
                    <Fact label="Fingerprint" title={data.admission.admission_fingerprint}>
                      {shortDigest(data.admission.admission_fingerprint)}
                    </Fact>
                    <p className="text-xs text-muted-foreground">
                      The fingerprint changes when the policy or the package&apos;s verified inputs do; an admission under
                      another fingerprint is invalid.
                    </p>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not admitted. A connection revision may name it, but no deployment over it can be planned until it is.
                    {aboveEdition ? ` This node (${edition}) cannot admit a ${pkg.tier} package.` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Connections over it ({users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground">No connection revision names this package.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {users.map((u) => (
                    <li key={u.group.connection_id}>
                      <Link
                        to={`/connections/${encodeURIComponent(u.group.connection_id)}`}
                        className="font-mono underline underline-offset-2"
                      >
                        {u.group.connection_id}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {u.revisions.map((r) => `r${r.revision}`).join(", ")}
                        {u.group.deployed?.provider_digest === digest ? ` · deployed r${u.group.deployed.revision}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations">
          {operations.length === 0 ? (
            <p className="text-sm text-muted-foreground">The manifest declares no operations.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead>Effect</TableHead>
                    <TableHead>Retry</TableHead>
                    <TableHead>Schemas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((o) => (
                    <TableRow key={o.name}>
                      <TableCell className="font-mono text-xs">{o.name}</TableCell>
                      <TableCell>{o.effect ?? "—"}</TableCell>
                      <TableCell>{o.retry ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {[o.input_schema, o.output_schema].filter(Boolean).join(" → ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="files">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">The inventory lists no files.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Path</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>SHA-256</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.path}>
                      <TableCell className="font-mono text-xs">{f.path}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatBytes(f.size)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground" title={f.sha256}>
                        {f.sha256.slice(0, 12)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="manifest" className="space-y-3">
          <JsonViewer data={pkg.manifest} label="connector.json" maxHeight="32rem" />
          <JsonViewer data={pkg.distribution} label="distribution.json" maxHeight="16rem" />
        </TabsContent>
      </Tabs>

      {revoking && (
        <RevokeDialog
          digest={pkg.digest}
          name={`${pkg.provider_id} ${pkg.version}`}
          deployedUsers={deployedUsers.map((u) => u.group.connection_id)}
          onClose={() => setRevoking(false)}
        />
      )}
    </div>
  )
}

function RevokeDialog({
  digest,
  name,
  deployedUsers,
  onClose,
}: {
  digest: string
  name: string
  deployedUsers: string[]
  onClose: () => void
}) {
  const revoke = useRevokePackage()
  const [reason, setReason] = useState("")
  return (
    <Dialog open onClose={onClose} className="max-w-lg" aria-label={`Revoke ${name}`}>
      <DialogHeader>
        <DialogTitle>Revoke {name}?</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Revocation is permanent for this digest: no deployment naming a connection over it can be planned again, and
          every call through it is refused at dispatch.
        </p>
        {deployedUsers.length > 0 && (
          <Callout variant="warning">
            The head deploys {deployedUsers.length === 1 ? "a connection" : `${deployedUsers.length} connections`} over it (
            {deployedUsers.join(", ")}). Their calls start failing as soon as this is revoked.
          </Callout>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="revoke-reason">Reason</Label>
          <Input id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For the audit log" />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate({ digest, reason: reason.trim() || undefined }, { onSuccess: onClose })}
        >
          {revoke.isPending ? "Revoking…" : "Revoke"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
