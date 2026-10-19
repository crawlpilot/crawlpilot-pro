/**
 * Markdown post-processing (thenos `post/*`), outside fenced code (code is left exactly as written):
 *
 * - newlines inside a link label become backslash continuations, so a label that wrapped stays one link;
 * - skip-navigation links ("Skip to main content") are removed;
 * - zero-width and bidi control characters are removed (they hide text from people), no-break spaces
 *   become spaces, text is NFC-normalized (not NFKC: `m²` stays `m²`);
 * - machine text is dropped: a line that is a JSON object or array, or a long line with almost no spaces
 *   (minified code, base64);
 * - a line equal to the previous non-blank line is dropped (a card's image link and title link to the
 *   same place); table rows are left alone, repeated data rows are data;
 * - one trailing space is removed (two stay: a hard line break).
 */

const INVISIBLE = /[​-‍⁠﻿­‪-‮⁦-⁩‎‏]/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const SINGLE_TRAILING_SPACE = /(?<! ) $/;
const SKIP_LINK = /\[(?:skip (?:to (?:the )?)?(?:main )?(?:content|navigation|main)|jump to (?:main )?content)\]\([^)\s]*#[^)\s]*\)[ \t]*/gi;
const JSON_MIN = 120;
const MINIFIED_MIN = 400;
const MINIFIED_SPACE_RATIO = 0.02;

function escapeLabelNewlines(markdown: string): string {
    let depth = 0;
    let out = '';
    for (const ch of markdown) {
        if (ch === '[') depth++;
        else if (ch === ']') depth = Math.max(0, depth - 1);
        out += depth > 0 && ch === '\n' ? '\\\n' : ch;
    }
    return out;
}

function isMachineText(line: string): boolean {
    if (line.length >= JSON_MIN && '{['.includes(line[0]) && '}]'.includes(line[line.length - 1]) && (line.match(/":/g) ?? []).length >= 3) return true;
    return line.length >= MINIFIED_MIN && (line.match(/ /g) ?? []).length / line.length < MINIFIED_SPACE_RATIO;
}

export function tidy(markdown: string): string {
    const out: string[] = [];
    let fence: string | null = null;
    let previous = '';
    for (let line of markdown.split('\n')) {
        const m = FENCE.exec(line);
        if (m) {
            const marker = m[1][0];
            fence = fence === null ? marker : marker === fence ? null : fence;
            out.push(line);
            previous = line;
            continue;
        }
        if (fence !== null) { out.push(line); continue; }
        line = line.replace(INVISIBLE, '').normalize('NFC').replace(/ /g, ' ').replace(SINGLE_TRAILING_SPACE, '');
        const stripped = line.trim();
        if (stripped && (isMachineText(stripped) || (stripped === previous && !stripped.startsWith('|')))) continue;
        out.push(line);
        if (stripped) previous = stripped;
    }
    return out.join('\n');
}

export function postprocess(markdown: string): string {
    const result = tidy(escapeLabelNewlines(markdown).replace(SKIP_LINK, '')).replace(/\n{3,}/g, '\n\n').trim();
    return result ? `${result}\n` : '';
}

export interface Heading { level: number; text: string }

/** The ATX headings outside fenced code. */
export function outline(markdown: string): Heading[] {
    const out: Heading[] = [];
    let fence: string | null = null;
    for (const line of markdown.split('\n')) {
        const m = FENCE.exec(line);
        if (m) { const marker = m[1][0]; fence = fence === null ? marker : marker === fence ? null : fence; continue; }
        if (fence !== null) continue;
        const h = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(line);
        if (h) out.push({ level: h[1].length, text: h[2] });
    }
    return out;
}

/** `markdown` cut at the last block boundary under `maxChars`. */
export function truncateMarkdown(markdown: string, maxChars: number): { markdown: string; truncated: boolean } {
    if (markdown.length <= maxChars) return { markdown, truncated: false };
    const slice = markdown.slice(0, maxChars);
    const cut = slice.lastIndexOf('\n\n');
    return { markdown: `${(cut > maxChars * 0.5 ? slice.slice(0, cut) : slice).trimEnd()}\n`, truncated: true };
}
