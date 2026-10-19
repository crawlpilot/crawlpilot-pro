/** AI Extract's schema draft (what its schema box shows when opened): other tools can start it with a schema. */
export const EXTRACT_DRAFT_KEY = 'crawlpilot.aiExtract.draft';

export function setExtractDraft(schemaText: string) {
    try { localStorage.setItem(EXTRACT_DRAFT_KEY, schemaText); } catch { /* storage blocked: AI Extract opens with its default */ }
}
