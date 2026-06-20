function domain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url.slice(0, 30);
    }
}

function domainSummary(urls: string[]): string {
    const unique = [...new Set(urls.map(domain))].filter(Boolean);
    if (unique.length === 0) return '';
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return `${unique[0]}, ${unique[1]}`;
    return `${unique[0]} +${unique.length - 1}`;
}

export function buildInitialName(urls: string[]): string {
    if (urls.length === 0) return 'Extraction';
    const d = domainSummary(urls);
    const n = urls.length;
    return `${d} · ${n} URL${n !== 1 ? 's' : ''}`;
}

export function buildFinalName(urls: string[], completedCount: number): string {
    if (urls.length === 0) return `Extraction (${completedCount} pages)`;
    const d = domainSummary(urls);
    return `${d} · ${completedCount} page${completedCount !== 1 ? 's' : ''}`;
}

export function buildPreviewName(urls: string[], done: number, total: number): string {
    if (urls.length === 0) return `Live Preview (${done}/${total})`;
    const d = domainSummary(urls);
    return `${d} · ${done}/${total} (live)`;
}
