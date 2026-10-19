/** Scraper toolkit: page recon, the selector lab, the API finder, the AI view, tables, and the right-click unlocker. */
import { runRecon } from '../services/recon/ReconService';
import { LabPicker, evaluateSelector, highlightSelector, clearLabHighlights } from '../features/lab/SelectorLab';
import { requestNetEntries, clearNetEntries } from '../features/network/NetworkRelay';
import { buildPageView, ground } from '../services/ai-view/pageView';
import { INTERACTIVE_BUDGET, revealForReading } from '../services/reveal';
import { RightClickUnlocker } from '../features/utility/RightClickUnlocker';
import { fail, ok, on, send } from '../../shared/messages';
import { checkPageClaims, showCitation } from '../services/ai-view/claims';
import { pickRegion } from '../services/ai-view/pickRegion';
import { siteContacts } from '../services/contacts/site';
import { findTables, showTable } from '../services/tables/findTables';

const labPicker = new LabPicker();

export function registerToolkitHandlers() {
    on('CMD_RECON', async () => ok({ report: await runRecon() }));

    on('LAB_EVAL', ({ selector, expected, highlight }) => {
        if (!selector) return fail('No selector');
        const result = evaluateSelector(selector, expected);
        if (highlight !== false && !result.error) highlightSelector(selector);
        return ok({ result });
    });

    on('LAB_CLEAR', () => {
        clearLabHighlights();
        labPicker.stop();
        return ok();
    });

    on('LAB_PICK_START', () => {
        clearLabHighlights();
        labPicker.start(pick => { void send('LAB_PICKED', pick); });
        return ok();
    });

    on('TABLES_FIND', () => ok({ tables: findTables() }));
    on('TABLES_SHOW', ({ index }) => ok({ shown: showTable(index) }));

    on('NET_LIST', async () => ok(await requestNetEntries()));
    on('NET_CLEAR', () => { clearNetEntries(); return ok(); });
    // Non-HttpOnly cookies only: what the page itself can read.
    on('PAGE_COOKIE', () => ok({ cookie: document.cookie }));

    on('AI_PAGE_VIEW', async ({ chunkChars, maxChunks, reveal }) => {
        // Closed sections, inactive tabs and "Show more" text are opened first, then the page is put back.
        const revealed = await revealForReading(reveal ?? 'read', INTERACTIVE_BUDGET);
        try {
            const view = buildPageView(chunkChars, maxChunks, { markdown: revealed.markdownOptions });
            return ok({ view: { ...view, revealed: revealed.report } });
        } finally {
            await revealed.restore();
        }
    });
    on('AI_GROUND', ({ requests }) => ok({ results: ground(requests) }));
    on('AI_CHECK', ({ claims }) => ok({ results: checkPageClaims(claims) }));
    on('AI_SHOW', ({ ref, quote }) => ok({ shown: showCitation(ref, quote) }));
    on('AI_PICK_REGION', async () => ok({ region: await pickRegion() }));
    on('CMD_FIND_CONTACTS', async ({ follow }) => ok(await siteContacts(follow)));

    // Sent from the page, as the page's own call would be: its origin, its cookies, its CORS.
    on('CMD_API_FETCH', async ({ url, method, headers, body }) => {
        const res = await fetch(url, { method, headers, body, credentials: 'include', cache: 'no-store' });
        return ok({ status: res.status, text: await res.text() });
    });

    on('TOGGLE_RIGHT_CLICK', ({ enable }) => {
        if (enable) RightClickUnlocker.enable();
        else RightClickUnlocker.disable();
        return ok({ enabled: RightClickUnlocker.isEnabled() });
    });
}
