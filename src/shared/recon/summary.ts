/**
 * A recon report at a glance: one short value per fact (protection, rendering, data, pagination)
 * with how good it is for scraping, and the whole report as Markdown to paste into a ticket or chat.
 * Pure: tested on its own.
 */
import type { ReconReport, Recommendation, PaginationHint } from './types';
import { VERDICT_LABELS } from '../verdict/classifyPage';

export type FactTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface Fact {
    value: string;
    tone: FactTone;
}

const CAPTCHAS = new Set(['recaptcha', 'hcaptcha', 'turnstile', 'arkose']);

export function protectionFact(r: ReconReport): Fact {
    if (r.check.verdict !== 'ok') return { value: VERDICT_LABELS[r.check.verdict], tone: 'bad' };
    const vendors = r.check.botManagers.filter(b => !CAPTCHAS.has(b.id));
    if (vendors.length > 0) return { value: vendors.map(v => v.name).join(', '), tone: 'warn' };
    if (r.check.botManagers.length > 0) return { value: `CAPTCHA (${r.check.botManagers.map(b => b.name).join(', ')})`, tone: 'warn' };
    return { value: 'None seen', tone: 'good' };
}

export function renderingFact(r: ReconReport): Fact {
    if (r.rendering.needsJs) return { value: 'Needs JavaScript', tone: 'warn' };
    if (r.rendering.needsJs === false) return { value: 'In the server HTML', tone: 'good' };
    return { value: 'Unknown', tone: 'neutral' };
}

export function dataFact(r: ReconReport): Fact {
    const json = r.embedded.filter(e => e.kind !== 'opengraph' && e.kind !== 'microdata');
    if (json.length > 0) return { value: `${json.length} JSON source${json.length > 1 ? 's' : ''}`, tone: 'good' };
    if (r.embedded.length > 0) return { value: r.embedded.map(e => e.kind === 'opengraph' ? 'Open Graph' : 'Microdata').join(', '), tone: 'neutral' };
    return { value: 'None found', tone: 'neutral' };
}

export function paginationLabel(p: PaginationHint): string | null {
    if (p.relNext) return 'rel="next" links';
    if (p.pageParam) return `?${p.pageParam}= in the URL`;
    if (p.nextButton) return '"Next" button';
    if (p.loadMore) return '"Load more" button';
    return null;
}

export function paginationFact(r: ReconReport): Fact {
    const label = paginationLabel(r.pagination);
    if (!label) return { value: 'None seen', tone: 'neutral' };
    return { value: label, tone: r.pagination.relNext || r.pagination.pageParam ? 'good' : 'neutral' };
}

const APPROACH: Record<Recommendation['approach'], string> = {
    'http-json': 'HTTP + JSON',
    'http-html': 'HTTP + HTML',
    browser: 'Needs a browser',
    blocked: 'Blocked',
};

export function approachLabel(a: Recommendation['approach']): string {
    return APPROACH[a];
}

/** The report as Markdown: the verdict, the facts, the notes and the useful links. */
export function reconMarkdown(r: ReconReport, rec: Recommendation): string {
    const lines = [
        `## Page recon: ${r.title || r.url}`,
        '',
        r.url,
        '',
        `**${approachLabel(rec.approach)}**: ${rec.headline}`,
        '',
        `- Protection: ${protectionFact(r).value}`,
        `- Rendering: ${renderingFact(r).value}${r.rendering.frameworks.length ? ` (${r.rendering.frameworks.join(', ')})` : ''}`,
        `- Embedded data: ${r.embedded.length ? r.embedded.map(e => e.label).join(', ') : 'none'}`,
        `- Pagination: ${paginationLabel(r.pagination) ?? 'none seen'}`,
        `- robots.txt: ${!r.robots?.found ? 'not found' : r.robots.allowed ? 'allows this path' : `disallows this path (${r.robots.rule})`}`,
    ];
    if (r.canonical && r.canonical !== r.url) lines.push(`- Canonical: ${r.canonical}`);
    if (rec.notes.length) lines.push('', ...rec.notes.map(n => `> ${n}`));
    if (r.robots?.sitemaps.length) lines.push('', 'Sitemaps:', ...r.robots.sitemaps.map(s => `- ${s}`));
    if (r.feeds.length) lines.push('', 'Feeds:', ...r.feeds.map(f => `- ${f}`));
    return lines.join('\n') + '\n';
}
