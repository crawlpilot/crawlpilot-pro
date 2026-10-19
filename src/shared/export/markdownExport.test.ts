import { describe, expect, it } from 'vitest';
import { frontMatter, markdownFiles, markdownJsonl, pageMarkdown, pagesFromRows } from './markdownExport';

const page = { url: 'https://docs.test/guide/intro', title: 'Intro: "quick" start', author: 'Ana', lang: 'en', fetchedAt: '2026-10-19T10:00:00.000Z', markdown: '# Intro\n\nHello.\n\n## Setup\n\nRun it.' };

describe('markdown export', () => {
    it('front matter: quoted values, empty fields left out', () => {
        expect(frontMatter(page)).toBe('---\ntitle: "Intro: \\"quick\\" start"\nurl: "https://docs.test/guide/intro"\nauthor: "Ana"\nlang: "en"\nfetched_at: "2026-10-19T10:00:00.000Z"\n---\n');
        expect(pageMarkdown(page)).toContain('---\n\n# Intro\n\nHello.');
        expect(pageMarkdown(page, false)).toBe('# Intro\n\nHello.\n\n## Setup\n\nRun it.\n');
    });

    it('one file per page, named by title, unique, empty pages left out', () => {
        const files = markdownFiles([page, { ...page }, { url: 'https://docs.test/api/list', markdown: 'x' }, { url: 'https://docs.test/empty', markdown: '  ' }]);
        expect(files.map(f => f.path)).toEqual(['intro-quick-start.md', 'intro-quick-start-2.md', 'api-list.md']);
        expect(files[0].text.startsWith('---\ntitle:')).toBe(true);
    });

    it('JSONL: a page per line, or chunks with their heading trail', () => {
        const whole = markdownJsonl([page]).trim().split('\n').map(l => JSON.parse(l));
        expect(whole).toEqual([{ url: page.url, title: page.title, markdown: page.markdown, lang: 'en', fetched_at: page.fetchedAt }]);
        const chunked = markdownJsonl([page], 20).trim().split('\n').map(l => JSON.parse(l));
        expect(chunked.length).toBeGreaterThan(1);
        expect(chunked.every((c, i) => c.chunk_index === i && c.chunk_count === chunked.length)).toBe(true);
        expect(chunked.find(c => c.chunk.includes('Run it.')).chunk).toMatch(/^\(Section: Intro\)\n\n## Setup|\(Section: Intro › Setup\)/);
        expect(markdownJsonl([{ url: 'u', markdown: '' }])).toBe('');
    });

    it('pages from a metadata run\'s rows', () => {
        const columns = [{ id: 'source_url', type: 'url' }, { id: 'title', type: 'text' }, { id: 'markdown', type: 'markdown' }];
        const pages = pagesFromRows(columns, [{ source_url: 'https://a.test', title: 'A', language: 'de', markdown: '# A' }], 'T');
        expect(pages).toEqual([{ url: 'https://a.test', title: 'A', description: undefined, author: undefined, published: undefined, lang: 'de', fetchedAt: 'T', markdown: '# A' }]);
        expect(pagesFromRows([{ id: 'x', type: 'text' }], [{ x: 1 }])).toEqual([]);
    });
});
