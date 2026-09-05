/**
 * Reading `/health` (Orion 1.4–1.6): which page acts on a degraded component.
 * Lives in `lib/` because a component file may export only components (the
 * fast-refresh lint rule), and the dashboard needs the same answer the
 * engine page does.
 */
const COMPONENT_ROUTES: Record<string, string> = {
  connectors: "/connectors",
  channels: "/channels",
  plugins: "/plugins",
  cron: "/schedules",
}

/** The page that acts on a degraded component, or null when only the health report explains it. */
export function componentRoute(component: string): string | null {
  return COMPONENT_ROUTES[component] ?? null
}
