import { BrowserRouter, Routes, Route } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AppLayout } from "@/components/layout/app-layout"
import { DashboardPage } from "@/pages/dashboard"
import { InvocationsPage } from "@/pages/invocations"
import { InvocationDetailPage } from "@/pages/invocation-detail"
import { ChannelsPage } from "@/pages/channels"
import { ConnectorsPage } from "@/pages/connectors"
import { ConnectorDetailPage } from "@/pages/connector-detail"
import { DataPage } from "@/pages/data"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="invocations" element={<InvocationsPage />} />
            <Route path="invocations/:id" element={<InvocationDetailPage />} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="connectors" element={<ConnectorsPage />} />
            <Route path="connectors/:id" element={<ConnectorDetailPage />} />
            <Route path="data" element={<DataPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
