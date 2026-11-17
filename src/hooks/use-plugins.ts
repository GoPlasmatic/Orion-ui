import { useMemo } from "react"
import { useRegistry } from "@/hooks/use-registry"

/** Every plugin the head deploys. Reads the head manifest (`useRegistry`). */
export function usePlugins() {
  const registry = useRegistry()
  return { data: registry.plugins, isLoading: registry.isLoading, error: registry.error, empty: registry.empty, refetch: registry.refetch }
}

/** One deployed plugin by its member id. */
export function usePlugin(id: string) {
  const registry = useRegistry()
  const plugin = useMemo(() => registry.plugins.find((p) => p.plugin_id === id), [registry.plugins, id])
  return {
    data: plugin,
    isLoading: registry.isLoading && !plugin,
    error: registry.error,
    refetch: registry.refetch,
    notDeployed: !registry.isLoading && !registry.error && !plugin,
  }
}
