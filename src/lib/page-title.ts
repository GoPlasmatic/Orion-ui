const SUFFIX = "Orion"

/**
 * The tab title, with the page winning over the shell.
 *
 * `PageHeader` and `Breadcrumbs` name the page they are on; `AppLayout` sets
 * a fallback from the nav registry. All three run as effects on the same
 * navigation, and React runs a child's effect before its parent's, so the
 * shell would overwrite the page's title every time. The shell therefore
 * yields when the page has already titled the current path.
 */
let titledPath: string | null = null

export function setPageTitle(pathname: string, parts: string[]): void {
  document.title = [...parts.filter(Boolean), SUFFIX].join(" · ")
  titledPath = pathname
}

export function setFallbackTitle(pathname: string, label?: string): void {
  if (titledPath === pathname) return
  document.title = label ? `${label} · ${SUFFIX}` : SUFFIX
}
