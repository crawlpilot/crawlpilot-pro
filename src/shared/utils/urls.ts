/** The http(s) URLs in pasted text or a CSV: any line, any comma or tab separated cell, quotes stripped, each once. */
export function urlsFromText(text: string): string[] {
    const found: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        for (const part of line.split(/[,\t]/)) {
            const url = part.trim().replace(/^"|"$/g, '');
            if (url.startsWith('http://') || url.startsWith('https://')) found.push(url);
        }
    }
    return [...new Set(found)];
}
