import {
  Navigate,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
  useParams,
} from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { isAuthError } from "@/api/client"
import { Toaster } from "sonner"
import { ThemeProvider } from "@/lib/theme-provider"
import { useTheme } from "@/lib/use-theme"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import { AppLayout } from "@/components/layout/app-layout"
import { OperationsPage } from "@/pages/operations"
import { SystemMapPage } from "@/pages/system-map"
import { ChannelsPage } from "@/pages/channels"
import { ChannelDetailPage } from "@/pages/channel-detail"
import { WorkflowsPage } from "@/pages/workflows"
import { WorkflowDetailPage } from "@/pages/workflow-detail"
import { CircuitBreakersPage } from "@/pages/circuit-breakers"
import { TracesPage } from "@/pages/traces"
import { TraceDlqPage } from "@/pages/trace-dlq"
import { TraceDetailPage } from "@/pages/trace-detail"
import { AuditPage } from "@/pages/audit"
import { ConsolePage } from "@/pages/console"
import { PluginsPage } from "@/pages/plugins"
import { PluginDetailPage } from "@/pages/plugin-detail"
import { SchedulesPage } from "@/pages/schedules"
import { OccurrenceDetailPage } from "@/pages/occurrence-detail"
import { EnginePage } from "@/pages/engine"
import { CachesPage } from "@/pages/caches"
import { DeploymentsPage } from "@/pages/deployments"
import { DeploymentDetailPage } from "@/pages/deployment-detail"
import { ConnectionsPage } from "@/pages/connections"
import { ConnectionDetailPage } from "@/pages/connection-detail"
import { ProviderPackagesPage } from "@/pages/provider-packages"
import { ProviderPackageDetailPage } from "@/pages/provider-package-detail"
import { NotFoundPage } from "@/pages/not-found"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 or 403 cannot be retried into success: the credential has to
      // change first, and a retried 401 counts toward the server's lockout.
      retry: (failures, error) => !isAuthError(error) && failures < 1,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
      // Serve entity lists and detail reads from cache for half a minute
      // instead of refetching on every mount: the System Map alone issues
      // three 1000-row list calls, and a page visited twice in a row does not
      // need them twice. Polled queries keep their own intervals, and every
      // mutation invalidates its keys, so a write is never hidden behind this.
      staleTime: 30_000,
    },
  },
})

/** Preserves `#component-<name>` and any query on the way to the renamed page. */
function SettingsRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={`/engine${search}${hash}`} replace />
}

/**
 * 1.x's authoring routes (`/workflows/new`, `/channels/:id/edit`, …). In 2.0
 * a change is a deployment — compiled and applied with `orion-cli` — so the
 * forms are gone; an old link lands on what it was about instead of a 404.
 */
function AuthoringRedirect({ to }: { to: string }) {
  const { id } = useParams<{ id: string }>()
  const target = id ? `${to}/${encodeURIComponent(id)}` : to
  return <Navigate to={target} replace state={{ retiredAuthoring: true }} />
}

// A data router rather than <BrowserRouter>: `useBlocker` — the unsaved-changes
// guard on every form — exists only on this kind of router.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppLayout />}>
      <Route index element={<OperationsPage />} />
      <Route path="system-map" element={<SystemMapPage />} />
      <Route path="deployments" element={<DeploymentsPage />} />
      <Route path="deployments/:revision" element={<DeploymentDetailPage />} />
      <Route path="channels" element={<ChannelsPage />} />
      <Route path="channels/new" element={<AuthoringRedirect to="/channels" />} />
      <Route path="channels/:id" element={<ChannelDetailPage />} />
      <Route path="channels/:id/edit" element={<AuthoringRedirect to="/channels" />} />
      <Route path="workflows" element={<WorkflowsPage />} />
      <Route path="workflows/new" element={<AuthoringRedirect to="/workflows" />} />
      <Route path="workflows/:id" element={<WorkflowDetailPage />} />
      <Route path="workflows/:id/edit" element={<AuthoringRedirect to="/workflows" />} />
      <Route path="plugins" element={<PluginsPage />} />
      <Route path="plugins/new" element={<AuthoringRedirect to="/plugins" />} />
      <Route path="plugins/:id" element={<PluginDetailPage />} />
      <Route path="plugins/:id/edit" element={<AuthoringRedirect to="/plugins" />} />
      <Route path="connections" element={<ConnectionsPage />} />
      <Route path="connections/:id" element={<ConnectionDetailPage />} />
      <Route path="provider-packages" element={<ProviderPackagesPage />} />
      <Route path="provider-packages/:digest" element={<ProviderPackageDetailPage />} />
      {/* 1.x surfaces 2.0 replaced: connectors became connections (their ids
          were UUIDs, which name nothing now), models a provider behind a
          connection, and package receipts the deployment history. */}
      <Route path="connectors/*" element={<Navigate to="/connections" replace />} />
      <Route path="connectors" element={<Navigate to="/connections" replace />} />
      <Route path="models/*" element={<Navigate to="/connections" replace />} />
      <Route path="models" element={<Navigate to="/connections" replace />} />
      <Route path="packages" element={<Navigate to="/deployments" replace />} />
      <Route path="caches" element={<CachesPage />} />
      <Route path="circuit-breakers" element={<CircuitBreakersPage />} />
      <Route path="traces" element={<TracesPage />} />
      <Route path="traces/:id" element={<TraceDetailPage />} />
      <Route path="trace-dlq" element={<TraceDlqPage />} />
      <Route path="schedules" element={<SchedulesPage />} />
      <Route path="schedules/occurrences/:id" element={<OccurrenceDetailPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="console" element={<ConsolePage />} />
      <Route path="engine" element={<EnginePage />} />
      {/* "Settings" until 2026-09-05: old links and bookmarks still land. */}
      <Route path="settings" element={<SettingsRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  )
)

function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return <Toaster theme={resolvedTheme} richColors closeButton position="bottom-right" />
}

export default function App() {
  return (
    <ThemeProvider>
      <TimeZoneProvider>
        <QueryClientProvider client={queryClient}>
          <ThemedToaster />
          <RouterProvider router={router} />
        </QueryClientProvider>
      </TimeZoneProvider>
    </ThemeProvider>
  )
}
