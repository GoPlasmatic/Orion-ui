import { Link } from "react-router"
import type { EngineLoadIssues } from "@/api/types"
import { countLoadIssues } from "@/api/types"
import { Callout } from "@/components/ui/callout"

/**
 * What a runtime generation could not load (Orion 1.9).
 *
 * A reload does not fail because one entity did not load: the entity is
 * quarantined and everything else serves, so a 200 from a reload is not proof
 * that what was activated is serving. These four lists are how a node says
 * what it refused, and since 1.9 the server builds them from one collector for
 * both `/health` and `GET admin/engine/status` — so this renders them once and
 * the two surfaces cannot drift apart in wording or severity.
 *
 * Every entry is *this node's* answer. A peer reloads on the same epoch bump
 * and may refuse differently — a different `cron.enabled` is enough.
 */
export function LoadIssuesReport({ issues }: { issues: EngineLoadIssues }) {
  if (countLoadIssues(issues) === 0) return null

  const channels = issues.channels ?? []
  const connectors = issues.connectors ?? []
  const plugins = issues.plugins ?? []
  const models = issues.models ?? []

  return (
    <div className="space-y-3">
      {channels.length > 0 && (
        <IssueGroup
          count={channels.length}
          noun="channel"
          verb="quarantined"
          footnote="A quarantined channel's route is not served at all — the instance still reports healthy, which is exactly the silent-success failure worth reading here."
        >
          {channels.map((c) => (
            <li key={c.channel_id || c.channel}>
              <Link
                to={c.channel_id ? `/channels/${encodeURIComponent(c.channel_id)}` : "/channels"}
                className="font-mono"
              >
                {c.channel}
              </Link>
              {c.workflow_id && (
                <>
                  {" · "}
                  <Link
                    to={`/workflows/${encodeURIComponent(c.workflow_id)}`}
                    className="font-mono text-muted-foreground"
                  >
                    {c.workflow_id}
                  </Link>
                </>
              )}{" "}
              — {c.reason}
            </li>
          ))}
        </IssueGroup>
      )}

      {connectors.length > 0 && (
        <IssueGroup
          count={connectors.length}
          noun="connector"
          verb="did not load"
          footnote="Every task using one of these is failing right now. `stage` names the step that refused it — an env:// or var:// reference that did not resolve, a config that did not parse, or an endpoint whose scheme its backend cannot serve."
        >
          {connectors.map((c) => (
            <li key={c.connector_id || c.connector}>
              <Link
                to={
                  c.connector_id
                    ? `/connectors/${encodeURIComponent(c.connector_id)}`
                    : "/connectors"
                }
                className="font-mono"
              >
                {c.connector}
              </Link>{" "}
              · <span className="font-mono">{c.stage}</span> — {c.reason}
            </li>
          ))}
        </IssueGroup>
      )}

      {plugins.length > 0 && (
        <IssueGroup
          count={plugins.length}
          noun="plugin version"
          verb="did not load"
          footnote="Every workflow naming one of their functions is quarantined here, the same way a failed connector load takes down its users."
        >
          {plugins.map((p) => (
            <li key={`${p.plugin}-${p.version}`}>
              <Link to={`/plugins/${encodeURIComponent(p.plugin)}`} className="font-mono">
                {p.plugin} v{p.version}
              </Link>{" "}
              · <span className="font-mono">{p.stage}</span> — {p.reason}
            </li>
          ))}
        </IssueGroup>
      )}

      {models.length > 0 && (
        <IssueGroup
          count={models.length}
          noun="model version"
          verb="could not be carried"
          footnote="Every workflow naming one of these by literal id is quarantined here, and its channels answer 503. A workflow routing to a computed model id is answered per message and fails as `unavailable` instead."
        >
          {models.map((m) => (
            <li key={`${m.model}-${m.version}`}>
              <Link to={`/models/${encodeURIComponent(m.model)}`} className="font-mono">
                {m.model} v{m.version}
              </Link>{" "}
              · <span className="font-mono">{m.stage}</span> — {m.reason}
            </li>
          ))}
        </IssueGroup>
      )}
    </div>
  )
}

function IssueGroup({
  count,
  noun,
  verb,
  footnote,
  children,
}: {
  count: number
  noun: string
  verb: string
  footnote: string
  children: React.ReactNode
}) {
  return (
    <Callout variant="destructive">
      <p className="font-medium">
        {count} {noun}
        {count === 1 ? "" : "s"} {verb} on this node
      </p>
      <ul className="mt-1 space-y-1 text-xs">{children}</ul>
      <p className="mt-2 text-xs">{footnote}</p>
    </Callout>
  )
}
