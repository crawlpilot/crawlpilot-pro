// On-demand injected extraction script for the Page Summarizer. Injected via
// chrome.scripting.executeScript({files}) only when the summarizer opens —
// deliberately NOT part of the always-on content script bundle.
//
// Result is reported via chrome.runtime.sendMessage rather than the script's
// completion value: the crxjs `?script` build emits a dynamic-import loader,
// so InjectionResult.result is not reliable.
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import {
    SUMMARIZER_EXTRACTION_RESULT,
    type ExtractedContent,
    type ExtractionResultMessage
} from '../shared/types/summarizer';

const MAX_EXTRACT_CHARS = 80_000;

function truncateAtParagraph(text: string, maxChars: number): { text: string; truncated: boolean } {
    if (text.length <= maxChars) return { text, truncated: false };
    const slice = text.slice(0, maxChars);
    const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
    return { text: cut > maxChars * 0.5 ? slice.slice(0, cut + 1) : slice, truncated: true };
}

function collapseWhitespace(text: string): string {
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function heuristicExtract(): { text: string; source: ExtractedContent['source'] } {
    // Score every candidate instead of taking the first selector match — a
    // short sidebar/nav block matching an earlier selector shouldn't win over
    // the real article body matched by a later one.
    const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content'];
    let best = '';
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
            const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
            if (text.length > best.length) best = text;
        });
    }
    if (best.length > 200) return { text: best, source: 'heuristic' };
    return { text: (document.body?.innerText || document.body?.textContent || '').trim(), source: 'body' };
}

function extract(): ExtractedContent {
    let text = '';
    let source: ExtractedContent['source'] = 'body';
    let title = document.title || '';
    let byline: string | null = null;
    let excerpt: string | null = null;
    let siteName: string | null = null;

    try {
        if (isProbablyReaderable(document)) {
            const article = new Readability(document.cloneNode(true) as Document).parse();
            const articleText = (article?.textContent || '').trim();
            if (articleText.length > 200) {
                text = articleText;
                source = 'readability';
                title = article?.title || title;
                byline = article?.byline || null;
                excerpt = article?.excerpt || null;
                siteName = article?.siteName || null;
            }
        }
    } catch (e) {
        console.warn('Readability parse failed, falling back to heuristic:', e);
    }

    if (!text) {
        const fallback = heuristicExtract();
        text = fallback.text;
        source = fallback.source;
    }

    const capped = truncateAtParagraph(collapseWhitespace(text), MAX_EXTRACT_CHARS);
    return { title, byline, excerpt, siteName, text: capped.text, source, truncated: capped.truncated };
}

const message: ExtractionResultMessage = { type: SUMMARIZER_EXTRACTION_RESULT, payload: extract() };
chrome.runtime.sendMessage(message);
