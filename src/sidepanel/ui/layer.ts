/**
 * Where a popover renders. An open modal <dialog> sits in the browser's top layer, above anything
 * appended to <body>, so menus and tooltips opened from inside one render inside it instead.
 */
export function layerFor(el: Element | null | undefined): HTMLElement {
    return (el?.closest('dialog[open]') as HTMLElement | null) ?? document.body;
}
