/**
 * Browser APIs Chrome has and jsdom lacks. `CSS.escape` follows the CSSOM serialisation rules
 * (https://drafts.csswg.org/cssom/#serialize-an-identifier).
 */
if (typeof (globalThis as any).CSS?.escape !== 'function') {
    const escape = (value: string): string => {
        const s = String(value);
        let out = '';
        for (let i = 0; i < s.length; i++) {
            const code = s.charCodeAt(i);
            const ch = s.charAt(i);
            if (code === 0) { out += '�'; continue; }
            if ((code >= 0x1 && code <= 0x1f) || code === 0x7f
                || (i === 0 && code >= 0x30 && code <= 0x39)
                || (i === 1 && code >= 0x30 && code <= 0x39 && s.charCodeAt(0) === 0x2d)) {
                out += `\\${code.toString(16)} `;
                continue;
            }
            if (i === 0 && s.length === 1 && code === 0x2d) { out += `\\${ch}`; continue; }
            if (code >= 0x80 || code === 0x2d || code === 0x5f || (code >= 0x30 && code <= 0x39)
                || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
                out += ch;
                continue;
            }
            out += `\\${ch}`;
        }
        return out;
    };
    (globalThis as any).CSS = { ...(globalThis as any).CSS, escape };
}
