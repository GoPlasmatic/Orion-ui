/**
 * Browser storage behind the one contract every per-browser preference needs:
 * a read that answers `null` and a write that does nothing when the accessor
 * throws (a private window, blocked site data, a full quota), so the page
 * renders and the choice lasts for the session. Every preference — theme,
 * time zone, the sidebar, the console's history and headers, the palette's
 * recents, a dry-run payload — goes through here rather than
 * wrapping its own try/catch. The admin API key is the one value kept in
 * `sessionStorage` instead (`readSessionStorage`): it is a credential, so it
 * must not outlive the tab.
 */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write a value, or remove the key when `value` is null. */
export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode or a full quota: the choice lasts for the session.
  }
}

/** A JSON value, or `fallback` when the key is absent or does not parse. */
export function readStorageJson<T>(key: string, fallback: T): T {
  const raw = readStorage(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeStorageJson(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value))
}

/** `sessionStorage`: gone when the tab closes. For the admin API key only. */
export function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write a session value, or remove the key when `value` is null. */
export function writeSessionStorage(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the key lasts until the page reloads.
  }
}
