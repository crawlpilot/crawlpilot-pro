/** What was revealed before a page was read (docs/plans/ai-extract-v2-plan.md §3.1a). */

export type RevealMode = 'off' | 'read' | 'open';

export interface RevealSkip {
    label: string;
    reason: string;
}

export interface RevealReport {
    /** Sections read with no click (closed accordions, inactive tabs). */
    read: string[];
    /** Sections opened by a click. */
    opened: string[];
    /** Lazy tab panels captured. */
    tabs: string[];
    skipped: RevealSkip[];
    clicks: number;
    stopped?: 'navigated' | 'budget' | 'time';
}

/** "Specifications, Details · 2 tabs": what was revealed, short, for a row or a status line. */
export function revealSummary(r: RevealReport | undefined): string {
    if (!r) return '';
    const sections = [...new Set([...r.opened, ...r.read])];
    const parts: string[] = [];
    if (sections.length) parts.push(sections.slice(0, 6).join(', ') + (sections.length > 6 ? ` +${sections.length - 6}` : ''));
    if (r.tabs.length) parts.push(`${r.tabs.length} tab${r.tabs.length !== 1 ? 's' : ''}`);
    return parts.join(' · ');
}
