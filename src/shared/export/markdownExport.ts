/**
 * Pages as markdown files (docs/plans/automation-and-page-tools-plan.md §3.7): one page with front
 * matter, many pages as one `.md` file each (for a zip), or as `.jsonl` for an LLM dataset, whole or in
 * chunks that keep their heading trail.
 */
import { chunkMarkdown } from '../markdown/chunks';
import { slug } from '../utils/text';

export interface MarkdownPage {
    url: string;
    title?: string;
    description?: string;
    author?: string;
    published?: string;
    lang?: string;
    /** When the page was read (ISO). */
    fetchedAt?: string;
    markdown: string;
}

/** YAML front matter; values as JSON strings, which YAML reads as double-quoted strings. */
export function frontMatter(page: Omit<MarkdownPage, 'markdown'>): string {
    const fields: [string, string | undefined][] = [
        ['title', page.title], ['url', page.url], ['description', page.description], ['author', page.author],
        ['published', page.published], ['lang', page.lang], ['fetched_at', page.fetchedAt],
    ];
    const lines = fields.filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${JSON.stringify(v!.trim())}`);
    return `---\n${lines.join('\n')}\n---\n`;
}

export function pageMarkdown(page: MarkdownPage, withFrontMatter = true): string {
    const body = page.markdown.trim();
    return withFrontMatter ? `${frontMatter(page)}\n${body}\n` : `${body}\n`;
}

/** A file name for the page: its title, else its URL's path; unique within `used`. */
function fileName(page: MarkdownPage, used: Set<string>): string {
    let path = '';
    try { path = new URL(page.url).pathname; } catch { /* not a URL */ }
    const base = slug((page.title || path || 'page').slice(0, 80), '-', 'page');
    let name = `${base}.md`;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}.md`;
    used.add(name);
    return name;
}

/** One `.md` per page, with front matter: the files of a zip. */
export function markdownFiles(pages: MarkdownPage[]): { path: string; text: string }[] {
    const used = new Set<string>();
    return pages.filter(p => p.markdown.trim()).map(p => ({ path: fileName(p, used), text: pageMarkdown(p) }));
}

/** About 1,000 tokens of English: a common size for retrieval chunks. */
export const DEFAULT_CHUNK_CHARS = 4000;

/**
 * JSON Lines, one page per line (`url, title, markdown, lang, fetched_at`), or with `chunkChars` one
 * chunk per line (`url, title, chunk, chunk_index, chunk_count, lang, fetched_at`), each chunk starting
 * with its heading trail.
 */
export function markdownJsonl(pages: MarkdownPage[], chunkChars?: number): string {
    const lines: string[] = [];
    for (const p of pages) {
        const markdown = p.markdown.trim();
        if (!markdown) continue;
        const base = { url: p.url, title: p.title ?? '', lang: p.lang ?? '', fetched_at: p.fetchedAt ?? '' };
        if (!chunkChars) { lines.push(JSON.stringify({ url: base.url, title: base.title, markdown, lang: base.lang, fetched_at: base.fetched_at })); continue; }
        const chunks = chunkMarkdown(markdown, chunkChars, { trail: true });
        chunks.forEach((chunk, i) => lines.push(JSON.stringify({ url: base.url, title: base.title, chunk, chunk_index: i, chunk_count: chunks.length, lang: base.lang, fetched_at: base.fetched_at })));
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * The pages of a dataset with a markdown column (a metadata run's rows): the first markdown column,
 * and the page's URL, title, description, author, date and language where the row has them.
 */
export function pagesFromRows(columns: { id: string; type?: string }[], rows: Record<string, any>[], fetchedAt?: string): MarkdownPage[] {
    const md = columns.find(c => c.type === 'markdown')?.id;
    if (!md) return [];
    const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    return rows.map(r => ({
        url: str(r.source_url ?? r.url ?? r.canonicalUrl),
        title: str(r.title) || undefined,
        description: str(r.description) || undefined,
        author: str(r.author) || undefined,
        published: str(r.publishedDate) || undefined,
        lang: str(r.language) || undefined,
        fetchedAt,
        markdown: str(r[md]),
    }));
}
