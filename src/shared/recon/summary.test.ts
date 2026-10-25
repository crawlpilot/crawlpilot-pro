import { describe, it, expect } from 'vitest';
import { dataFact, paginationFact, protectionFact, reconMarkdown, renderingFact } from './summary';
import { recommend } from './recommend';
import type { ReconReport } from './types';
import type { BotManagerHit } from '../verdict/botManagers';

function report(over: Partial<ReconReport> = {}): ReconReport {
    return {
        url: 'https://ex.com/p/1', title: 'Lamp',
        check: { verdict: 'ok', reason: '', botManagers: [] },
        rendering: { frameworks: ['Next.js'], spaShell: false, liveTextLength: 5000, servedTextLength: 4800, servedStatus: 200, needsJs: false },
        embedded: [], hreflangCount: 0, feeds: [],
        pagination: { loadMore: false, nextButton: false },
        ...over,
    };
}

describe('recon facts', () => {
    it('protection: none, a vendor, a CAPTCHA only, or the wall itself', () => {
        expect(protectionFact(report())).toEqual({ value: 'None seen', tone: 'good' });
        const bm = (id: BotManagerHit['id'], name: string) => ({ id, name, evidence: 'cookie' });
        expect(protectionFact(report({ check: { verdict: 'ok', reason: '', botManagers: [bm('akamai', 'Akamai')] } }))).toEqual({ value: 'Akamai', tone: 'warn' });
        expect(protectionFact(report({ check: { verdict: 'ok', reason: '', botManagers: [bm('recaptcha', 'reCAPTCHA')] } })).value).toBe('CAPTCHA (reCAPTCHA)');
        expect(protectionFact(report({ check: { verdict: 'challenge', reason: '', botManagers: [] } }))).toEqual({ value: 'Bot check', tone: 'bad' });
    });

    it('rendering, data and pagination', () => {
        expect(renderingFact(report()).tone).toBe('good');
        expect(renderingFact(report({ rendering: { ...report().rendering, needsJs: true } })).value).toBe('Needs JavaScript');
        expect(dataFact(report()).value).toBe('None found');
        expect(dataFact(report({ embedded: [{ kind: 'json-ld', label: 'JSON-LD Product', size: 900 }, { kind: 'opengraph', label: 'Open Graph', size: 4 }] }))).toEqual({ value: '1 JSON source', tone: 'good' });
        expect(paginationFact(report({ pagination: { pageParam: 'page', loadMore: false, nextButton: true } }))).toEqual({ value: '?page= in the URL', tone: 'good' });
        expect(paginationFact(report({ pagination: { loadMore: true, nextButton: false } })).value).toBe('"Load more" button');
    });
});

describe('reconMarkdown', () => {
    it('has the verdict, the facts and the links', () => {
        const r = report({
            robots: { found: true, status: 200, allowed: true, rule: '', sitemaps: ['https://ex.com/sitemap.xml'] },
            embedded: [{ kind: 'json-ld', label: 'JSON-LD Product', size: 900, types: ['Product'] }],
        });
        const md = reconMarkdown(r, recommend(r));
        expect(md).toContain('## Page recon: Lamp');
        expect(md).toContain('**HTTP + JSON**');
        expect(md).toContain('- Rendering: In the server HTML (Next.js)');
        expect(md).toContain('- Embedded data: JSON-LD Product');
        expect(md).toContain('- https://ex.com/sitemap.xml');
    });
});
