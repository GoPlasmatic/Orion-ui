import { BrowserRouter, Routes, Route } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { ThemeProvider } from "@/lib/theme-provider"
import { useTheme } from "@/lib/use-theme"
import { AppLayout } from "@/components/layout/app-layout"
import { OperationsPage } from "@/pages/operations"
import { SystemMapPage } from "@/pages/system-map"
import { ChannelsPage } from "@/pages/channels"
import { ChannelDetailPage } from "@/pages/channel-detail"
import { ChannelFormPage } from "@/pages/channel-form"
import { WorkflowsPage } from "@/pages/workflows"
import { WorkflowDetailPage } from "@/pages/workflow-detail"
import { ConnectorsPage } from "@/pages/connectors"
import { ConnectorDetailPage } from "@/pages/connector-detail"
import { ConnectorFormPage } from "@/pages/connector-form"
import { CircuitBreakersPage } from "@/pages/circuit-breakers"
import { TracesPage } from "@/pages/traces"
import { TraceDetailPage } from "@/pages/trace-detail"
import { AuditPage } from "@/pages/audit"
import { ConsolePage } from "@/pages/console"
import { SettingsPage } from "@/pages/settings"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
    },
  },
})

function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return <Toaster theme={resolvedTheme} richColors closeButton position="bottom-right" />
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ThemedToaster />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<OperationsPage />} />
              <Route path="system-map" element={<SystemMapPage />} />
              <Route path="channels" element={<ChannelsPage />} />
              <Route path="channels/new" element={<ChannelFormPage />} />
              <Route path="channels/:id" element={<ChannelDetailPage />} />
              <Route path="channels/:id/edit" element={<ChannelFormPage />} />
              <Route path="workflows" element={<WorkflowsPage />} />
              <Route path="workflows/:id" element={<WorkflowDetailPage />} />
              <Route path="connectors" element={<ConnectorsPage />} />
              <Route path="connectors/new" element={<ConnectorFormPage />} />
              <Route path="connectors/:id" element={<ConnectorDetailPage />} />
              <Route path="connectors/:id/edit" element={<ConnectorFormPage />} />
              <Route path="circuit-breakers" element={<CircuitBreakersPage />} />
              <Route path="traces" element={<TracesPage />} />
              <Route path="traces/:id" element={<TraceDetailPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="console" element={<ConsolePage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
