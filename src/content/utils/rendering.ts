/**
 * True when the element paints content on the page. Unlike a bare
 * offsetWidth/offsetHeight check this also accepts `display: contents`
 * elements: they generate no box of their own (0x0, offsetParent null)
 * but their children render normally. LinkedIn's 2026 web wraps every
 * list card in a `display: contents` div, so filtering on box size alone
 * drops the entire card.
 */
export function hasRenderedBox(el: HTMLElement): boolean {
    if (el.offsetWidth > 0 || el.offsetHeight > 0) return true;
    // Only elements with children can render anything through display:contents;
    // this also avoids the getComputedStyle call for ordinary hidden leaves.
    if (el.childElementCount === 0) return false;
    return getComputedStyle(el).display === 'contents';
}
