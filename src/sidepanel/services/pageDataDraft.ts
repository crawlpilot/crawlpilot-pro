/**
 * Fields picked in "Data on this page", handed to the Page Extractor to run on more pages: the
 * elements (bound to the page's data, no selectors), how lists land in the output, and the page they
 * were picked on. Kept in memory: both screens are in the same side panel.
 */
import type { DataElement } from '../../shared/pageJson/scan';

export interface PageDataDraft {
    elements: DataElement[];
    listOutput: 'nested' | 'rows';
    url: string;
}

let draft: PageDataDraft | null = null;

export function setPageDataDraft(next: PageDataDraft) {
    draft = next;
}

/** The draft, once: the Page Extractor takes it when it opens. */
export function takePageDataDraft(): PageDataDraft | null {
    const out = draft;
    draft = null;
    return out;
}
