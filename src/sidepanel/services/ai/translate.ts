/**
 * Any language for the Page assistant (docs/plans/summarize-ask-plan.md A4), with Chrome's on-device
 * Language Detector and Translator (stable in extensions since Chrome 138):
 *
 * - a page not in English is translated to English for the model, line by line so every block keeps
 *   its `[bN]` reference;
 * - what the assistant says is translated into the user's language when that isn't English.
 *
 * A language pair's model downloads once; creating a translator for a pair not yet downloaded needs a
 * click (user activation), so that case is reported (`needs-download`) for the screen to ask.
 */

export interface TranslatorLike {
    translate(text: string): Promise<string>;
    destroy?(): void;
}

function api(): { Translator?: any; LanguageDetector?: any } {
    return globalThis as any;
}

export function translationSupported(): boolean {
    return typeof api().Translator !== 'undefined' && typeof api().LanguageDetector !== 'undefined';
}

/** "ko" → "Korean" (in English: the assistant's own words are English). */
export function languageName(code: string): string {
    try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

let detector: Promise<any> | null = null;

/** The language of a text: its code when the detector is confident, else null. */
export async function detectLanguage(text: string): Promise<string | null> {
    const LD = api().LanguageDetector;
    if (!LD || text.trim().length < 20) return null;
    try {
        detector ??= LD.create();
        const results: { detectedLanguage: string; confidence: number }[] = await (await detector).detect(text.slice(0, 3000));
        const best = results?.[0];
        if (!best || best.detectedLanguage === 'und' || best.confidence < 0.6) return null;
        return best.detectedLanguage.split('-')[0];
    } catch {
        detector = null;
        return null;
    }
}

const translators = new Map<string, Promise<TranslatorLike>>();

export type TranslatorResult = { translator: TranslatorLike } | { needs: 'download' } | { unsupported: true };

/** A translator for `source → target`, kept for the session; a pair still to download needs a click. */
export async function translatorFor(source: string, target: string, onProgress?: (fraction: number) => void): Promise<TranslatorResult> {
    const T = api().Translator;
    if (!T || source === target) return { unsupported: true };
    const key = `${source}>${target}`;
    const cached = translators.get(key);
    if (cached) return { translator: await cached };
    let availability: string;
    try { availability = await T.availability({ sourceLanguage: source, targetLanguage: target }); } catch { return { unsupported: true }; }
    if (availability === 'unavailable') return { unsupported: true };
    if (availability !== 'available' && !navigator.userActivation?.isActive) return { needs: 'download' };
    const created: Promise<TranslatorLike> = T.create({
        sourceLanguage: source, targetLanguage: target,
        monitor(m: any) { m.addEventListener('downloadprogress', (e: any) => onProgress?.(typeof e?.loaded === 'number' ? e.loaded : 0)); },
    });
    translators.set(key, created);
    try {
        return { translator: await created };
    } catch {
        translators.delete(key);
        return { unsupported: true };
    }
}

const MARKER = /\s*\[(b\d+(?:\s*,\s*b\d+)*)\]\s*$/;

/**
 * A page view chunk translated line by line: each line's words translated, its `[bN]` kept as is.
 * Lines without words (markup, numbers) stay. Translations run one at a time (Chrome queues them).
 */
export async function translateChunk(translator: TranslatorLike, chunk: string): Promise<string> {
    const out: string[] = [];
    for (const line of chunk.split('\n')) {
        const marker = line.match(MARKER);
        const body = marker ? line.slice(0, marker.index) : line;
        const lead = body.match(/^\s*(?:[#>*-]+\s+|\d+\.\s+|\|)?/)?.[0] ?? '';
        const words = body.slice(lead.length);
        if (!/\p{L}{2}/u.test(words)) { out.push(line); continue; }
        const translated = await translator.translate(words).catch(() => words);
        out.push(`${lead}${translated}${marker ? ` [${marker[1]}]` : ''}`);
    }
    return out.join('\n');
}

/** Text in another language, keeping `[bN]` markers where they were (answers, sentence by sentence). */
export async function translateCited(translator: TranslatorLike, text: string): Promise<string> {
    const parts = text.split(/(\s?\[b\d+(?:\s*,\s*b\d+)*\])/);
    const out: string[] = [];
    for (const part of parts) {
        if (/^\s?\[b\d+/.test(part) || !/\p{L}{2}/u.test(part)) out.push(part);
        else out.push(await translator.translate(part).catch(() => part));
    }
    return out.join('');
}
