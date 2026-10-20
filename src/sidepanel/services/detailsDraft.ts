/**
 * A list's details run, handed from the List Extractor to the Page Extractor (docs/plans/product-
 * improvements-plan.md §5, S4): the list's item links to open, and the list the fields join onto.
 * Kept in memory: both screens are in the same side panel.
 */
export interface DetailsDraft {
    /** The list's table, and its column of item links. */
    tableId: number;
    urlColumn: string;
    /** The item links, each once, in the list's order. */
    urls: string[];
    listName: string;
}

let draft: DetailsDraft | null = null;

export function setDetailsDraft(next: DetailsDraft) {
    draft = next;
}

/** The draft, once: the Page Extractor takes it when it opens. */
export function takeDetailsDraft(): DetailsDraft | null {
    const out = draft;
    draft = null;
    return out;
}
