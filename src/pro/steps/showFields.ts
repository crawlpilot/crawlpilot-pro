/**
 * Check (`docs/plans/pro-ops-workflow-review.md`): each field's element outlined on the page with the field's name,
 * green when its value checks out, red when it doesn't, grey when it's empty. A field read from the page's data or
 * markup has no element to outline. Plain DOM code in Pro's step script (`contentSteps.ts`).
 */
import { resolveItems } from '../../shared/selectors/resolve';

export interface ShownField {
    name: string;
    selectors: string[];
    tone: 'ok' | 'bad' | 'empty';
}

const LAYER = 'crawlpilot-check-layer';
const COLORS = { ok: '#15803d', bad: '#dc2626', empty: '#6b7280' };
const shown = new Map<string, Element>();

const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** The field's element: the first selector that finds a visible one. */
function elementOf(selectors: string[]): Element | undefined {
    for (const sel of selectors) {
        const el = resolveItems([sel], document).result.find(visible);
        if (el) return el;
    }
    return undefined;
}

export function clearFields() {
    document.getElementById(LAYER)?.remove();
    shown.clear();
}

/** Outlines the fields' elements; returns the names of those it found on the page. */
export function showFields(fields: ShownField[]): string[] {
    clearFields();
    const layer = document.createElement('div');
    layer.id = LAYER;
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
    for (const f of fields) {
        const el = elementOf(f.selectors);
        if (!el) continue;
        shown.set(f.name, el);
        const r = el.getBoundingClientRect();
        const box = document.createElement('div');
        box.dataset.field = f.name;
        box.style.cssText = `position:absolute;left:${r.left + scrollX - 2}px;top:${r.top + scrollY - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;`
            + `border:2px solid ${COLORS[f.tone]};border-radius:4px;box-sizing:border-box;transition:box-shadow .3s;`;
        const tag = document.createElement('div');
        tag.textContent = f.name;
        tag.style.cssText = `position:absolute;left:-2px;top:-20px;padding:1px 6px;font:600 11px/16px system-ui,sans-serif;color:#fff;background:${COLORS[f.tone]};border-radius:4px;white-space:nowrap;`;
        box.appendChild(tag);
        layer.appendChild(box);
    }
    document.body.appendChild(layer);
    return [...shown.keys()];
}

/** Brings a field's element into view and flashes its outline. */
export function focusField(name: string): boolean {
    const el = shown.get(name);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const box = document.querySelector(`#${LAYER} [data-field="${CSS.escape(name)}"]`) as HTMLElement | null;
    if (box) {
        box.style.boxShadow = '0 0 0 6px rgba(250,204,21,.6)';
        setTimeout(() => { box.style.boxShadow = ''; }, 1200);
    }
    return true;
}
