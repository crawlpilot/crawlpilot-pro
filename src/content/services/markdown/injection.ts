/**
 * Drops visible page text that gives instructions to an AI (thenos `clean/injection.py`). Hidden text is
 * already gone (compose keeps rendered nodes only). A block is dropped when its text has
 *
 * - a **strong** signal on its own: "ignore (all) previous instructions", a system/developer prompt
 *   marker, chat-template tokens (`<|im_start|>`, `[INST]`), "new instructions:", "do not tell the user"; or
 * - a **weak** signal (text addressed to a model: "dear AI", "if you are an AI", "LLMs reading this
 *   page") together with an imperative in the same sentence, in a block of at most 500 characters.
 *
 * The smallest block holding the match is dropped, never `body`, `main` or `article`. Prose that
 * mentions AI without addressing a model ("chat with our AI") stays. A heuristic, not a guarantee: the
 * model prompt also fences page text as data, and every value is grounded against the page.
 */

const STRONG = new RegExp(
    String.raw`\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)*(previous|prior|above|earlier|preceding|original)\s+(instructions?|prompts?|messages?|rules|directions)`
    + String.raw`|\b(system|developer)\s+(prompt|message|instructions?)\s*:`
    + String.raw`|<\|?\s*(im_start|im_end|system|endoftext)\s*\|?>|\[/?INST\]`
    + String.raw`|\b(new|updated|real|actual)\s+instructions?\s*:`
    + String.raw`|\bdo\s+not\s+(tell|inform|alert|reveal\s+(this\s+)?to)\s+the\s+user\b`,
    'i',
);
const MODEL = String.raw`(ai|a\.i\.|ai\s+(assistant|agent|model|system)s?|language\s+models?|llms?|chatbots?|chatgpt|gpt(-?\d)?|claude|gemini|copilot)`;
const ADDRESSED = new RegExp(
    String.raw`\b(dear|attention|note\s+to|hey|hi|hello|to)\s+(the\s+|any\s+|all\s+)?${MODEL}\b`
    + String.raw`|\b(if\s+you\s+are|you\s+are|as)\s+(an?\s+)?${MODEL}\b`
    + String.raw`|\b${MODEL}\s+(reading|processing|summari[sz]ing|parsing|browsing|crawling|visiting)\b`
    + String.raw`|^\s*(${MODEL}|assistant|system)\s*[:,]`,
    'i',
);
const IMPERATIVE = /\b(ignore|disregard|forget|reveal|send|email|navigate\s+to|go\s+to|click|must|instead|you\s+are\s+now|from\s+now\s+on|respond\s+(only\s+)?with|output|print|execute)\b/i;
const SENTENCE = /(?<=[.!?])\s+|\n+/;
const KEPT = new Set(['html', 'body', 'main', 'article']);
const BLOCKS = new Set(['p', 'li', 'td', 'th', 'dd', 'dt', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section', 'span', 'a', 'label', 'figcaption', 'caption', 'summary']);

/** Weak signals only count in short blocks: a long description that says "System:" and "output" isn't one. */
const WEAK_MAX_CHARS = 500;

export function looksInjected(text: string): boolean {
    if (STRONG.test(text)) return true;
    if (text.length > WEAK_MAX_CHARS) return false;
    return text.split(SENTENCE).some(s => ADDRESSED.test(s) && IMPERATIVE.test(s));
}

/** The element's text with a line break at every block boundary, so sentences don't run together. */
function textOf(el: Element): string {
    const parts: string[] = [];
    const walk = (node: Element) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) parts.push(child.nodeValue ?? '');
            else if (child.nodeType === Node.ELEMENT_NODE) {
                const block = BLOCKS.has((child as Element).localName) && (child as Element).localName !== 'span' && (child as Element).localName !== 'a';
                if (block) parts.push('\n');
                walk(child as Element);
                if (block) parts.push('\n');
            }
        }
    };
    walk(el);
    return parts.join('').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function dropInjections(root: Element): number {
    const found: Element[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
        if (!BLOCKS.has(el.localName)) continue;
        const text = textOf(el);
        if (!text || !looksInjected(text)) continue;
        const inner = Array.from(el.querySelectorAll('*')).some(c => BLOCKS.has(c.localName) && looksInjected(textOf(c)));
        if (!inner) found.push(el);
    }
    let dropped = 0;
    for (const el of found) {
        if (!root.contains(el) || KEPT.has(el.localName)) continue;
        el.remove();
        dropped++;
    }
    return dropped;
}
