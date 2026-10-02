/**
 * How every map canvas frames itself: on open, on a lens change (each lens is
 * its own canvas, so mounting is opening), after a cluster or domain is folded
 * or opened, and from the Fit control.
 *
 * `minZoom` is the overview floor — dots and lanes legible, names not
 * necessarily; zooming in is one scroll, not being able to see the whole
 * system is not. `maxZoom` stops a small map (or one summary box) being
 * blown up past life size, which is what made an opened cluster land at 100%
 * on six nodes.
 */
export const FIT_MIN_ZOOM = 0.15
export const FIT_MAX_ZOOM = 1

export function fitOptions(reducedMotion: boolean, nodes?: { id: string }[]) {
  return {
    padding: 0.06,
    duration: reducedMotion ? 0 : 400,
    minZoom: FIT_MIN_ZOOM,
    maxZoom: FIT_MAX_ZOOM,
    ...(nodes ? { nodes } : {}),
  }
}
