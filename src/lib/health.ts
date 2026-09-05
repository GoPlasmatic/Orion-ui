/**
 * Reading `/health` (Orion 1.4–1.6): which page acts on a degraded component.
 * Lives in `lib/` because a component file may export only components (the
 * fast-refresh lint rule), and the dashboard needs the same answer the
 * settings page does.
 */
const COMPONENT_ROUTES: Record<string, string> = {
  connectors: "/connectors",
  channels: "/channels",
  plugins: "/plugins",
  cron: "/schedules",
}

/** Where to go to act on a degraded component; the health report otherwise. */
export function componentRoute(component: string): string {
  return COMPONENT_ROUTES[component] ?? "/settings"
}

/** Whether a component has a page of its own to inspect. */
export function hasComponentRoute(component: string): boolean {
  return component in COMPONENT_ROUTES
}
