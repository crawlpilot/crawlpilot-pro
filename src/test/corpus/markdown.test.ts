/**
 * The markdown corpus: every corpus page through the markdown engine (`content/services/markdown`), in
 * `markdown` and `fit` mode. `markdown-report.json` pins the shape of each output (blocks by kind,
 * table shapes, what each stage dropped, and chrome that leaked into `fit`); `markdown/<page>.md` pins
 * the `fit` output itself, so a converter change reads as a diff of real pages.
 * Update after an intended change with `npx vitest run src/test/corpus/markdown -u`.
 */
import { describe, expect, it } from 'vitest';
import { loadPage } from './measure';
import { toMarkdown, type MarkdownMode } from '../../content/services/markdown';

const PAGES: Record<string, string> = {
    'amazon-search': 'corpus/amazon-search.html.gz',
    'walmart-search': 'corpus/walmart-search.html.gz',
    'walmart-carousel': 'walmart-carousel.html',
    'bootstrap-grid': 'bootstrap-grid.html',
    'tailwind-grid': 'tailwind-grid.html',
    'emotion-hashed': 'emotion-hashed.html',
    'pdp-amazon': 'corpus/pdp-amazon.html.gz',
    'pdp-walmart': 'corpus/pdp-walmart.html.gz',
    'pdp-uniqlo': 'corpus/pdp-uniqlo.html.gz',
    'pdp-zara': 'corpus/pdp-zara.html.gz',
    'article-wikipedia': 'corpus/article-wikipedia.html.gz',
    'docs-mdn': 'corpus/docs-mdn.html.gz',
};

function shape(markdown: string) {
    const lines = markdown.split('\n');
    const tables: string[] = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith('|') && lines[i + 1]?.startsWith('| ---')) {
            const cols = lines[i + 1].split('---').length - 1;
            let rows = 0;
            for (i += 2; lines[i]?.startsWith('|'); i++) rows++;
            tables.push(`${cols}x${rows}`);
        } else i++;
    }
    return {
        chars: markdown.length,
        headings: lines.filter(l => /^#{1,6} /.test(l)).length,
        tables,
        listItems: lines.filter(l => /^\s*(- |\d+\. )/.test(l)).length,
        codeBlocks: Math.floor(lines.filter(l => /^```/.test(l)).length / 2),
        images: (markdown.match(/!\[[^\]]*\]\(/g) ?? []).length,
        links: (markdown.match(/(?<!!)\[[^\]]*\]\(/g) ?? []).length,
    };
}

/** Text of the page's navigation and footer blocks (40+ chars) that still appears in `markdown`. */
function chromeLeaks(markdown: string): number {
    const flat = markdown.replace(/\s+/g, ' ');
    return Array.from(document.querySelectorAll('nav, footer, [role="navigation"], [role="contentinfo"]'))
        .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length >= 40)
        .filter(t => flat.includes(t.slice(0, 40)))
        .length;
}

describe('markdown corpus', () => {
    it('matches the pinned report and fit outputs', async () => {
        const report: Record<string, Record<string, unknown>> = {};
        for (const [name, file] of Object.entries(PAGES)) {
            report[name] = {};
            for (const mode of ['markdown', 'fit'] as MarkdownMode[]) {
                loadPage(file);
                const r = toMarkdown(document, { live: false, mode });
                report[name][mode] = {
                    title: r.title.slice(0, 80),
                    attempt: `${r.attempt.mode}${r.attempt.mainContent ? '' : ' (whole page)'}`,
                    ...shape(r.markdown),
                    dropped: { boilerplate: r.stats.boilerplateDropped, pruned: r.stats.prunedDropped, injections: r.stats.injectionsDropped },
                    keptShare: r.stats.composedChars ? Math.round((r.stats.keptChars / r.stats.composedChars) * 100) / 100 : 0,
                    chromeLeaks: chromeLeaks(r.markdown),
                };
                if (mode === 'fit') await expect(r.markdown).toMatchFileSnapshot(`./markdown/${name}.md`);
            }
        }
        await expect(JSON.stringify(report, null, 2) + '\n').toMatchFileSnapshot('./markdown-report.json');
    }, 120_000);
});
