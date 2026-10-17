/** Scraper toolkit: page recon, the selector lab, the API finder, the AI view, and the right-click unlocker. */
import { runRecon } from '../services/recon/ReconService';
import { LabPicker, evaluateSelector, highlightSelector, clearLabHighlights } from '../features/lab/SelectorLab';
import { requestNetEntries, clearNetEntries } from '../features/network/NetworkRelay';
import { buildReferencedView, verifyAndCompile } from '../services/ai-view/ReferencedView';
import { RightClickUnlocker } from '../features/utility/RightClickUnlocker';
import { fail, ok, on, send } from '../../shared/messages';

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

    on('AI_BUILD_VIEW', p => ok(buildReferencedView(p?.maxChars)));
    on('AI_VERIFY', p => ok({ fields: verifyAndCompile(p?.answers || []) }));

    on('TOGGLE_RIGHT_CLICK', ({ enable }) => {
        if (enable) RightClickUnlocker.enable();
        else RightClickUnlocker.disable();
        return ok({ enabled: RightClickUnlocker.isEnabled() });
    });
}
