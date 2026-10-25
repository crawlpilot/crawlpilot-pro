/** Export a captured API request as code, and spot the parameters that page through results. */
import type { NetEntry } from './types';

export type RequestTarget = 'curl' | 'python' | 'fetch' | 'scrapy';

export const REQUEST_TARGET_LABELS: Record<RequestTarget, string> = {
    curl: 'cURL',
    python: 'Python requests',
    fetch: 'JS fetch',
    scrapy: 'Scrapy',
};

/** Headers the browser adds or that only make sense inside this browser session. */
const DROP_HEADERS = /^(host|content-length|connection|accept-encoding|cookie|sec-|:)/i;
const SENSITIVE = /^(authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|x-access-token)$/i;

export function exportableHeaders(entry: NetEntry, includeAuth: boolean): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.requestHeaders)) {
        if (DROP_HEADERS.test(k)) continue;
        if (!includeAuth && SENSITIVE.test(k)) continue;
        out[k] = v;
    }
    return out;
}

export function hasSensitiveHeaders(entry: NetEntry): boolean {
    return Object.keys(entry.requestHeaders).some(k => SENSITIVE.test(k));
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const pyq = (s: string) => JSON.stringify(s);

export function toRequestSnippet(target: RequestTarget, entry: NetEntry, opts: { includeAuth?: boolean; cookie?: string } = {}): string {
    const headers = exportableHeaders(entry, !!opts.includeAuth);
    if (opts.cookie) headers['cookie'] = opts.cookie;
    const method = entry.method.toUpperCase();
    const body = entry.requestBody && method !== 'GET' && method !== 'HEAD' ? entry.requestBody : undefined;
    const hdrEntries = Object.entries(headers);

    switch (target) {
        case 'curl': {
            const lines = [`curl ${shq(entry.url)}`];
            if (method !== 'GET') lines.push(`  -X ${method}`);
            hdrEntries.forEach(([k, v]) => lines.push(`  -H ${shq(`${k}: ${v}`)}`));
            if (body) lines.push(`  --data-raw ${shq(body)}`);
            lines.push('  --compressed');
            return lines.join(' \\\n');
        }
        case 'python': {
            const h = hdrEntries.map(([k, v]) => `    ${pyq(k)}: ${pyq(v)},`).join('\n');
            const isJsonBody = body && /^\s*[\[{]/.test(body);
            const lines = ['import requests', '', `headers = {\n${h}\n}`];
            if (body) lines.push(isJsonBody ? `payload = ${body}` : `data = ${pyq(body)}`);
            const args = [`${pyq(entry.url)}`, 'headers=headers'];
            if (body) args.push(isJsonBody ? 'json=payload' : 'data=data');
            lines.push('', `resp = requests.${method.toLowerCase()}(${args.join(', ')}, timeout=30)`, 'resp.raise_for_status()', 'data = resp.json()');
            return lines.join('\n');
        }
        case 'fetch': {
            const init: Record<string, unknown> = { method, headers };
            if (body) init.body = body;
            return `const resp = await fetch(${JSON.stringify(entry.url)}, ${JSON.stringify(init, null, 2)});\nconst data = await resp.json();`;
        }
        case 'scrapy': {
            const h = hdrEntries.map(([k, v]) => `            ${pyq(k)}: ${pyq(v)},`).join('\n');
            return [
                'import json',
                'import scrapy',
                '',
                'class ApiSpider(scrapy.Spider):',
                '    name = "api"',
                '',
                '    def start_requests(self):',
                '        yield scrapy.Request(',
                `            ${pyq(entry.url)},`,
                `            method=${pyq(method)},`,
                `            headers={\n${h}\n            },`,
                ...(body ? [`            body=${pyq(body)},`] : []),
                '            callback=self.parse,',
                '        )',
                '',
                '    def parse(self, response):',
                '        data = json.loads(response.text)',
                '        yield data',
            ].join('\n');
        }
    }
}

const PAGE_PARAM = /^(page|p|pg|pagenum|page_?number|pageindex|offset|start|from|skip|cursor|after|before|next|nextpage|next_?cursor|continuation|token|page_?token|last_?id|since_?id)$/i;
const SIZE_PARAM = /^(limit|size|per_?page|page_?size|count|rows|num|take|first|max_?results|hits_?per_?page)$/i;

export interface PagingParam {
    name: string;
    value: string;
    role: 'page' | 'size';
    where: 'query' | 'body';
}

/** Query-string and JSON-body parameters that look like pagination controls. */
export function detectPagingParams(entry: NetEntry): PagingParam[] {
    const out: PagingParam[] = [];
    try {
        new URL(entry.url).searchParams.forEach((value, name) => {
            if (PAGE_PARAM.test(name)) out.push({ name, value, role: 'page', where: 'query' });
            else if (SIZE_PARAM.test(name)) out.push({ name, value, role: 'size', where: 'query' });
        });
    } catch { /* relative or invalid URL */ }
    if (entry.requestBody && /^\s*\{/.test(entry.requestBody)) {
        try {
            const visit = (obj: any, depth: number) => {
                if (!obj || typeof obj !== 'object' || depth > 3) return;
                for (const [k, v] of Object.entries(obj)) {
                    if (v !== null && typeof v === 'object') { visit(v, depth + 1); continue; }
                    if (PAGE_PARAM.test(k)) out.push({ name: k, value: String(v), role: 'page', where: 'body' });
                    else if (SIZE_PARAM.test(k)) out.push({ name: k, value: String(v), role: 'size', where: 'body' });
                }
            };
            visit(JSON.parse(entry.requestBody), 0);
        } catch { /* not JSON */ }
    }
    return out;
}
