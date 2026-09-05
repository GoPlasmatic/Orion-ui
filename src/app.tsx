import {
  Navigate,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
} from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { ThemeProvider } from "@/lib/theme-provider"
import { useTheme } from "@/lib/use-theme"
import { DensityProvider } from "@/lib/density-provider"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import { AppLayout } from "@/components/layout/app-layout"
import { OperationsPage } from "@/pages/operations"
import { SystemMapPage } from "@/pages/system-map"
import { ChannelsPage } from "@/pages/channels"
import { ChannelDetailPage } from "@/pages/channel-detail"
import { ChannelFormPage } from "@/pages/channel-form"
import { WorkflowsPage } from "@/pages/workflows"
import { WorkflowDetailPage } from "@/pages/workflow-detail"
import { WorkflowFormPage } from "@/pages/workflow-form"
import { ConnectorsPage } from "@/pages/connectors"
import { ConnectorDetailPage } from "@/pages/connector-detail"
import { ConnectorFormPage } from "@/pages/connector-form"
import { CircuitBreakersPage } from "@/pages/circuit-breakers"
import { TracesPage } from "@/pages/traces"
import { TraceDlqPage } from "@/pages/trace-dlq"
import { TraceDetailPage } from "@/pages/trace-detail"
import { AuditPage } from "@/pages/audit"
import { ConsolePage } from "@/pages/console"
import { PackagesPage } from "@/pages/packages"
import { PluginsPage } from "@/pages/plugins"
import { PluginDetailPage } from "@/pages/plugin-detail"
import { PluginFormPage } from "@/pages/plugin-form"
import { SchedulesPage } from "@/pages/schedules"
import { OccurrenceDetailPage } from "@/pages/occurrence-detail"
import { EnginePage } from "@/pages/engine"
import { NotFoundPage } from "@/pages/not-found"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
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

// A data router rather than <BrowserRouter>: `useBlocker` — the unsaved-changes
// guard on every form — exists only on this kind of router.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppLayout />}>
      <Route index element={<OperationsPage />} />
      <Route path="system-map" element={<SystemMapPage />} />
      <Route path="channels" element={<ChannelsPage />} />
      <Route path="channels/new" element={<ChannelFormPage />} />
      <Route path="channels/:id" element={<ChannelDetailPage />} />
      <Route path="channels/:id/edit" element={<ChannelFormPage />} />
      <Route path="workflows" element={<WorkflowsPage />} />
      <Route path="workflows/new" element={<WorkflowFormPage />} />
      <Route path="workflows/:id" element={<WorkflowDetailPage />} />
      <Route path="workflows/:id/edit" element={<WorkflowFormPage />} />
      <Route path="plugins" element={<PluginsPage />} />
      <Route path="plugins/new" element={<PluginFormPage />} />
      <Route path="plugins/:id" element={<PluginDetailPage />} />
      <Route path="plugins/:id/edit" element={<PluginFormPage />} />
      <Route path="connectors" element={<ConnectorsPage />} />
      <Route path="connectors/new" element={<ConnectorFormPage />} />
      <Route path="connectors/:id" element={<ConnectorDetailPage />} />
      <Route path="connectors/:id/edit" element={<ConnectorFormPage />} />
      <Route path="circuit-breakers" element={<CircuitBreakersPage />} />
      <Route path="traces" element={<TracesPage />} />
      <Route path="traces/:id" element={<TraceDetailPage />} />
      <Route path="trace-dlq" element={<TraceDlqPage />} />
      <Route path="schedules" element={<SchedulesPage />} />
      <Route path="schedules/occurrences/:id" element={<OccurrenceDetailPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="console" element={<ConsolePage />} />
      <Route path="packages" element={<PackagesPage />} />
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
      <DensityProvider>
      <TimeZoneProvider>
      <QueryClientProvider client={queryClient}>
        <ThemedToaster />
        <RouterProvider router={router} />
      </QueryClientProvider>
      </TimeZoneProvider>
      </DensityProvider>
    </ThemeProvider>
  )
}
