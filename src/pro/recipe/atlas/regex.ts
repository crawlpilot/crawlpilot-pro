/**
 * Java regexes (Atlas templates and asserts) as JavaScript ones. Atlas compiles a template's regex with
 * DOTALL and CASE_INSENSITIVE, an assert's with none; inline flag groups (`(?i)`, anywhere) become flags,
 * `\A` / `\z` anchors, atomic groups plain ones, and a pattern with `\p{…}` gets the `u` flag (and loses
 * the escapes `u` refuses, like `\,`). What still doesn't compile is reported, not guessed at.
 */

export type JsRegex = { pattern: string; flags: string } | { error: string };

/** Escapes JS accepts in `u` mode; any other `\x` is a Java identity escape (`\,` is `,`). */
const U_ESCAPES = /[dDwWsSbBnrtfv0-9^$\\.*+?()[\]{}|/pPuxck-]/;

export function javaRegex(source: string, baseFlags: string): JsRegex {
    const flags = new Set(baseFlags);
    let pattern = source.replace(/\(\?([imsux]+)\)/g, (_, f: string) => {
        for (const c of f) if (c === 'i' || c === 's' || c === 'm') flags.add(c);
        return '';
    });
    pattern = pattern.replace(/\\A/g, '^').replace(/\\[zZ]/g, '$').replace(/\(\?>/g, '(?:');
    if (/\\[pP]\{/.test(pattern)) {
        flags.add('u');
        pattern = pattern.replace(/\\([\s\S])/g, (m, c: string) => U_ESCAPES.test(c) ? m : c);
    }
    const out = { pattern, flags: [...flags].sort().join('') };
    try {
        new RegExp(out.pattern, out.flags);
        return out;
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
