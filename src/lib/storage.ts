/**
 * `localStorage` behind the one contract every per-browser preference needs:
 * a read that answers `null` and a write that does nothing when the accessor
 * throws (a private window, blocked site data, a full quota), so the page
 * renders and the choice lasts for the session. Every preference — theme,
 * density, time zone, the sidebar, the console's history and headers, the
 * palette's recents, a dry-run payload — goes through here rather than
 * wrapping its own try/catch.
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
