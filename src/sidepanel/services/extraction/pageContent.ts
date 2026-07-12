import readableExtractScript from '@/content/readable-extract?script';
import {
    SUMMARIZER_EXTRACTION_RESULT,
    type ExtractedContent,
    type ExtractionResultMessage
} from '@/shared/types/summarizer';

const EXTRACTION_TIMEOUT_MS = 10_000;

async function getActiveTabId(): Promise<number | null> {
    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
        tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    return tabs[0]?.id ?? null;
}

// Waits for the injected script's result message. Registered BEFORE injection
// so a fast script can't send the message into the void.
function waitForExtractionResult(tabId: number): { promise: Promise<ExtractedContent>; cleanup: () => void } {
    let listener: ((msg: any, sender: chrome.runtime.MessageSender) => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
        if (listener) chrome.runtime.onMessage.removeListener(listener);
        if (timer) clearTimeout(timer);
        listener = null;
        timer = null;
    };

    const promise = new Promise<ExtractedContent>((resolve, reject) => {
        listener = (msg: ExtractionResultMessage, sender) => {
            if (msg?.type !== SUMMARIZER_EXTRACTION_RESULT || sender.tab?.id !== tabId) return;
            cleanup();
            resolve(msg.payload);
        };
        chrome.runtime.onMessage.addListener(listener);
        timer = setTimeout(() => {
            cleanup();
            reject(new Error('Extraction timed out.'));
        }, EXTRACTION_TIMEOUT_MS);
    });

    return { promise, cleanup };
}

// Second-chance path when the bundled Readability script can't run (e.g. the
// page's CSP or a race killed the dynamic import): a serializable inline
// function using the selector-scoring heuristic.
async function extractViaInlineHeuristic(tabId: number): Promise<ExtractedContent | null> {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            try {
                const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content'];
                let best = '';
                for (const sel of selectors) {
                    document.querySelectorAll(sel).forEach((el) => {
                        const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
                        if (text.length > best.length) best = text;
                    });
                }
                const text = best.length > 200
                    ? best
                    : (document.body?.innerText || document.body?.textContent || '').trim();
                return { title: document.title || '', text: text.substring(0, 80000) };
            } catch {
                return null;
            }
        }
    });

    const result = results?.[0]?.result;
    if (!result?.text) return null;
    return {
        title: result.title,
        byline: null,
        excerpt: null,
        siteName: null,
        text: result.text,
        source: 'heuristic',
        truncated: result.text.length === 80000
    };
}

// Extracts the main readable content of the active tab. Returns null when
// nothing can be extracted (restricted pages like chrome://, Web Store,
// PDFs — or empty pages); callers show their "no text found" state.
export async function extractActiveTabContent(): Promise<ExtractedContent | null> {
    let tabId: number | null = null;
    try {
        tabId = await getActiveTabId();
        if (tabId === null) return null;

        const { promise, cleanup } = waitForExtractionResult(tabId);
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: [readableExtractScript]
            });
            return await promise;
        } catch (err) {
            cleanup();
            throw err;
        }
    } catch (err) {
        console.warn('Readability extraction failed, trying inline heuristic:', err);
        if (tabId === null) return null;
        try {
            return await extractViaInlineHeuristic(tabId);
        } catch (fallbackErr) {
            console.error('Extraction failed (restricted page?):', fallbackErr);
            return null;
        }
    }
}
