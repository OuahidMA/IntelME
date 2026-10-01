const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

/**
 * Scrolls a page section into view, smoothly unless the visitor has asked for
 * reduced motion. Sections carry `scroll-mt-*`, so the sticky navbar offset is
 * already accounted for.
 */
export function scrollToSection(id) {
  const target = document.getElementById(id)
  if (!target) return false

  const smooth = !window.matchMedia(REDUCED_MOTION).matches
  target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" })

  return true
}
