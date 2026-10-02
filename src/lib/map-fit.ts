/**
 * How every map canvas frames itself, and the thresholds both node-link
 * lenses share. Each lens is its own canvas, so mounting is opening: a canvas
 * fits on open, when the set it draws changes, after a cluster or domain
 * folds or opens, and from the Fit control.
 */

/**
 * Overview floor for a fit — dots and lanes legible, names not necessarily;
 * zooming in is one scroll, not being able to see the whole system is not.
 */
export const FIT_MIN_ZOOM = 0.15

/**
 * Below this zoom a node stops trying to be a card and becomes a dot with a
 * name large enough to survive the scale. The footprint does not change — the
 * layout is zoom-independent — only what is drawn inside it.
 */
export const LOD_ZOOM = 0.55

/** Nodes on a canvas before a minimap earns its corner. */
export const MINIMAP_AT = 15

/**
 * Crowds — a cluster of entries, a domain — start folded only on a map big
 * enough for it to matter, and only when they are a real crowd. On an
 * eleven-channel system a folded box would hide most of the map.
 */
export const COLLAPSE_MAP_AT = 30
export const COLLAPSE_CLUSTER_AT = 6

/**
 * `maxZoom: 1` stops a small map (or one summary box) being blown up past
 * life size, which is what made an opened cluster land at 100% on six nodes.
 */
export function fitOptions(reducedMotion: boolean) {
  return { padding: 0.06, duration: reducedMotion ? 0 : 400, minZoom: FIT_MIN_ZOOM, maxZoom: 1 }
}

/** Travel to one node at reading zoom, keeping the move a pan rather than a jump. */
export function revealOptions(reducedMotion: boolean, id: string) {
  return { nodes: [{ id }], duration: reducedMotion ? 0 : 500, maxZoom: 1, minZoom: 0.5 }
}
