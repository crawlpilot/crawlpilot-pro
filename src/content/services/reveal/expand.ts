/**
 * Opening what only appears on a click (docs/plans/ai-extract-v2-plan.md §3.1a, layer 2): lazy
 * accordions, tabs whose panel is built when selected, "Show more" / "Read full description" buttons.
 *
 * Safe by construction:
 * - only controls in the main content: never in `nav`, `header`, `footer`, a form, a dialog or a menu;
 * - never a link that navigates, a submit button, or a control whose text reads like an action
 *   (add to cart, buy, sign in, subscribe, delete, accept…);
 * - a control with a popup (`aria-haspopup`: menus, listboxes) is left alone;
 * - one click at a time, waiting for the page to settle; a cap on clicks and on time;
 * - if the URL changes, it stops at once; if a dialog opens, it is closed with Escape and that control
 *   is skipped.
 *
 * A lazy tab's panel is cloned while it is open (`captured`), since selecting the next tab removes it.
 * `restore` closes what was opened and selects the tab that was selected, so the page looks as before.
 */
import { labelOf, panelsOf, visible } from './disclosure';

export interface RevealBudget {
    clicks: number;
    ms: number;
}

export interface Skipped {
    label: string;
    reason: string;
}

export interface ExpandResult {
    /** Labels of the sections opened by a click. */
    opened: string[];
    /** Lazy tab panels cloned while open (the page shows one at a time). */
    captured: { label: string; el: Element }[];
    skipped: Skipped[];
    clicks: number;
    /** Why it stopped early. */
    stopped?: 'navigated' | 'budget' | 'time';
    restore: () => Promise<void>;
}

const OUTSIDE = 'nav, header, footer, form, dialog, [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [aria-modal="true"], [role="menu"], [role="menubar"], [role="listbox"], [role="search"]';
const EXPANDER = /^(show|read|see|view)\s+(more|all|full|the full|entire|details|description|specs|specifications)\b|^more( details| info(rmation)?)?$|^expand( all)?\b|^(full|see all|all) (description|details|specs|specifications)\b|^(product )?(details|specifications|specs|description)$/i;
const DENY = /\b(add to|cart|bag|basket|wish ?list|buy|checkout|check out|pay|order|book|reserve|subscribe|sign ?in|log ?in|sign ?up|register|join|delete|remove|accept|agree|allow|decline|reject|follow|like|share|vote|report|unsubscribe|close|dismiss|download|print|apply|contact|call|chat|compare|notify|less)\b/i;
const MAX_TEXT = 40;
const QUIET_MS = 300;
const SETTLE_MAX_MS = 1500;

/** Waits until the DOM has been quiet for a moment (or a cap passes). */
export function settle(doc: Document = document, quiet = QUIET_MS, max = SETTLE_MAX_MS): Promise<void> {
    return new Promise(resolve => {
        let timer = setTimeout(done, quiet);
        const cap = setTimeout(done, max);
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
        observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
        function done() { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); }
    });
}

const textOf = (el: Element) => labelOf(el);
const dialogs = (doc: Document) => doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"]').length;

function navigates(el: Element): boolean {
    const a = el.closest('a[href]');
    if (!a) return false;
    const href = (a.getAttribute('href') ?? '').trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return false;
    // A link styled as a button that opens a panel on this page is not a navigation.
    return !(a.getAttribute('role') === 'button' && a.hasAttribute('aria-controls'));
}

/** Why `el` must not be clicked, or null when it is safe. */
export function unsafe(el: Element): string | null {
    const text = textOf(el);
    if (el.closest(OUTSIDE)) return 'outside the main content';
    // A sidebar of checkboxes is a filter panel; product details in an aside stay allowed.
    const aside = el.closest('aside, [role="complementary"]');
    if (aside?.querySelector('input[type="checkbox"], input[type="radio"]')) return 'in a filter panel';
    if (el.hasAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') return 'opens a menu';
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
    if (el.localName === 'button' && (el as HTMLButtonElement).type === 'submit' && el.closest('form')) return 'submits a form';
    if (navigates(el)) return 'opens another page';
    if (DENY.test(text)) return 'looks like an action, not a section';
    return null;
}

const controlled = (doc: Document, el: Element): (Element | null)[] => panelsOf(doc, el);
const filled = (panel: Element | null) => !!panel && (panel.textContent ?? '').trim().length > 20;

interface Candidate { el: Element; kind: 'toggle' | 'tab' | 'expander' }

/** What a click would open: toggles whose panel isn't in the page yet, lazy tabs, and "Show more" buttons. */
export function candidates(doc: Document = document, live = true): Candidate[] {
    const out: Candidate[] = [];
    const seen = new Set<Element>();
    const push = (el: Element, kind: Candidate['kind']) => { if (!seen.has(el) && visible(el, live)) { seen.add(el); out.push({ el, kind }); } };

    for (const el of Array.from(doc.querySelectorAll('[aria-expanded="false"]'))) {
        if (el.getAttribute('role') === 'tab' || el.localName === 'summary') continue;
        const panels = controlled(doc, el);
        // A panel already in the page is read with no click (disclosure.ts).
        if (panels.length && panels.every(filled)) continue;
        push(el, 'toggle');
    }
    for (const el of Array.from(doc.querySelectorAll('[role="tab"]:not([aria-selected="true"])'))) {
        const panels = controlled(doc, el);
        if (panels.length && panels.every(filled)) continue;
        push(el, 'tab');
    }
    for (const el of Array.from(doc.querySelectorAll('button, [role="button"], a[href^="#"], a:not([href])'))) {
        if (el.getAttribute('aria-expanded') === 'true') continue;
        const text = textOf(el);
        if (!text || text.length > MAX_TEXT || !EXPANDER.test(text)) continue;
        const panels = controlled(doc, el);
        if (panels.length && panels.every(filled)) continue;
        push(el, 'expander');
    }
    return out;
}

export async function expandHidden(budget: RevealBudget, doc: Document = document, live = true): Promise<ExpandResult> {
    const startedAt = Date.now();
    const startUrl = doc.location?.href ?? '';
    const opened: string[] = [];
    const captured: ExpandResult['captured'] = [];
    const skipped: Skipped[] = [];
    const toggledOpen: Element[] = [];
    const selectedTab = new Map<Element, Element>();
    let clicks = 0;
    let stopped: ExpandResult['stopped'];
    const tried = new Set<Element>();

    // Candidates are found again after each click: opening a section can reveal another "Show more".
    for (let round = 0; round < 3 && !stopped; round++) {
        const list = candidates(doc, live).filter(c => !tried.has(c.el));
        if (!list.length) break;
        for (const { el, kind } of list) {
            tried.add(el);
            const label = textOf(el) || kind;
            const why = unsafe(el);
            if (why) { skipped.push({ label, reason: why }); continue; }
            if (clicks >= budget.clicks) { stopped = 'budget'; break; }
            if (Date.now() - startedAt > budget.ms) { stopped = 'time'; break; }

            if (kind === 'tab') {
                const list = el.closest('[role="tablist"]');
                const current = list?.querySelector('[role="tab"][aria-selected="true"]');
                if (list && current && !selectedTab.has(list)) selectedTab.set(list, current);
            }
            const dialogsBefore = dialogs(doc);
            (el as HTMLElement).click();
            clicks++;
            await settle(doc);

            if ((doc.location?.href ?? '') !== startUrl) { stopped = 'navigated'; skipped.push({ label, reason: 'opened another page' }); break; }
            if (dialogs(doc) > dialogsBefore) {
                doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                doc.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                skipped.push({ label, reason: 'opened a dialog' });
                continue;
            }
            if (kind === 'tab') {
                for (const panel of controlled(doc, el)) if (filled(panel)) captured.push({ label, el: panel!.cloneNode(true) as Element });
                if (!captured.some(c => c.label === label)) {
                    const panel = doc.querySelector(`[role="tabpanel"][aria-labelledby~="${el.id}"]`);
                    if (el.id && filled(panel)) captured.push({ label, el: panel!.cloneNode(true) as Element });
                }
            } else {
                if (el.isConnected && el.getAttribute('aria-expanded') === 'true') toggledOpen.push(el);
                opened.push(label);
            }
        }
    }

    const restore = async () => {
        for (const el of toggledOpen.reverse()) {
            if (el.isConnected && el.getAttribute('aria-expanded') === 'true') { (el as HTMLElement).click(); }
        }
        for (const tab of selectedTab.values()) if (tab.isConnected && tab.getAttribute('aria-selected') !== 'true') (tab as HTMLElement).click();
        if (toggledOpen.length || selectedTab.size) await settle(doc, 100, 600);
    };
    return { opened, captured, skipped, clicks, ...(stopped ? { stopped } : {}), restore };
}
