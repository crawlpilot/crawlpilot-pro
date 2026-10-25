/**
 * Hidden content that is still in the page, tied to a control the user can see
 * (docs/plans/ai-extract-v2-plan.md §3.1a, layer 1): read as if open, with no click.
 *
 * - the panel an `aria-expanded="false"` control points at (`aria-controls`);
 * - inactive tab panels (`role="tab"` → `aria-controls`, or `role="tabpanel"` labelled by a tab);
 * - collapsed regions labelled by a visible control (`role="region"` + `aria-labelledby`: Radix, shadcn);
 * - Bootstrap's `.collapse:not(.show)` with a visible toggle (`data-bs-target`, `data-target`, `href`).
 *
 * Hidden content with no visible control stays out: that is where hidden prompt injections live.
 * A closed `<details>` is already read by `compose`.
 */

export interface Panel {
    /** The control's text: "Specifications". */
    label: string;
    /** A tab panel: only one shows at a time, so it is read under its tab's name. */
    tab: boolean;
}

const MAX_LABEL = 60;
/** Site navigation is not content: its menus stay closed. */
const CHROME = 'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="menu"], [role="menubar"]';

export function labelOf(el: Element): string {
    const text = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, MAX_LABEL);
}

/** Whether the user can see `el` (no layout: only `hidden` and inline styles count). */
export function visible(el: Element, live: boolean): boolean {
    if ((el as HTMLElement).hidden || el.closest('[hidden],[aria-hidden="true"]')) return false;
    if (!live) {
        for (let at: Element | null = el; at; at = at.parentElement) {
            const style = (at as HTMLElement).style;
            if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        }
        return true;
    }
    const check = (el as any).checkVisibility;
    if (typeof check === 'function') return check.call(el, { visibilityProperty: true });
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

/** The panels a control opens: `aria-controls`, or Bootstrap's `data-bs-target` / `data-target` / `href="#id"`. */
export function panelsOf(doc: Document, control: Element): Element[] {
    const aria = byIds(doc, control.getAttribute('aria-controls'));
    if (aria.length) return aria;
    const target = control.getAttribute('data-bs-target') ?? control.getAttribute('data-target') ?? (control.getAttribute('href')?.startsWith('#') ? control.getAttribute('href') : null);
    const id = target?.startsWith('#') ? target.slice(1) : null;
    const el = id ? doc.getElementById(id) : null;
    return el ? [el] : [];
}

function byIds(doc: Document, ids: string | null): Element[] {
    return (ids ?? '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);
}

/** Panels to read as if open, each with its control's label. Only panels that are hidden now are listed. */
export function disclosurePanels(doc: Document = document, live = true): Map<Element, Panel> {
    const panels = new Map<Element, Panel>();
    const add = (panel: Element, control: Element, tab: boolean) => {
        if (panels.has(panel) || visible(panel, live) || !visible(control, live) || control.closest(CHROME)) return;
        if (!(panel.textContent ?? '').trim()) return;
        panels.set(panel, { label: labelOf(control), tab });
    };

    for (const control of Array.from(doc.querySelectorAll('[aria-expanded="false"][aria-controls]'))) {
        if (control.getAttribute('role') === 'tab' || control.hasAttribute('aria-haspopup')) continue;
        for (const panel of byIds(doc, control.getAttribute('aria-controls'))) add(panel, control, false);
    }
    for (const tab of Array.from(doc.querySelectorAll('[role="tab"]'))) {
        if (tab.getAttribute('aria-selected') === 'true') continue;
        for (const panel of byIds(doc, tab.getAttribute('aria-controls'))) add(panel, tab, true);
    }
    for (const panel of Array.from(doc.querySelectorAll('[role="tabpanel"][aria-labelledby]'))) {
        const tab = byIds(doc, panel.getAttribute('aria-labelledby'))[0];
        if (tab) add(panel, tab, true);
    }
    for (const panel of Array.from(doc.querySelectorAll('[role="region"][aria-labelledby]'))) {
        const control = byIds(doc, panel.getAttribute('aria-labelledby'))[0];
        if (control) add(panel, control, false);
    }
    for (const panel of Array.from(doc.querySelectorAll('.collapse:not(.show)[id]'))) {
        const id = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(panel.id) : panel.id.replace(/[^\w-]/g, '\\$&');
        const control = doc.querySelector(`[data-bs-target="#${id}"], [data-target="#${id}"], a[href="#${id}"]`);
        if (control) add(panel, control, false);
    }
    return panels;
}
