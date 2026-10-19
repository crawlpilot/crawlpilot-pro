/** Scraper toolkit: page recon, the selector lab, the API finder, the AI view, and the right-click unlocker. */
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

    on('NET_LIST', async () => ok(await requestNetEntries()));
    on('NET_CLEAR', () => { clearNetEntries(); return ok(); });
    // Non-HttpOnly cookies only: what the page itself can read.
    on('PAGE_COOKIE', () => ok({ cookie: document.cookie }));

    on('AI_PAGE_VIEW', async ({ chunkChars, maxChunks, reveal }) => {
        // Closed sections, inactive tabs and "Show more" text are opened first, then the page is put back.
        const revealed = await revealForReading(reveal ?? 'open', INTERACTIVE_BUDGET);
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

    on('TOGGLE_RIGHT_CLICK', ({ enable }) => {
        if (enable) RightClickUnlocker.enable();
        else RightClickUnlocker.disable();
        return ok({ enabled: RightClickUnlocker.isEnabled() });
    });
}
