/** True while a sideways scroller still has content beyond its right edge. One pixel of slack covers rounding. */
export function moreToScroll(el: { scrollLeft: number; clientWidth: number; scrollWidth: number }): boolean {
  return el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
}
