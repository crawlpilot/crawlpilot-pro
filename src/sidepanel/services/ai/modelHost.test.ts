import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { modelHost, modelStatus, modelSupported, codeFor, MODEL_OPTIONS } from './modelHost';

/**
 * A fake Prompt API, close to the documented behaviour: sessions with a context window, clones that
 * copy their base's usage, measurement, constrained prompts, and the documented exception names.
 */
type PromptFn = (text: string, opts: any, session: FakeLM) => Promise<string> | string;

class FakeLM extends EventTarget {
    static availabilityValue: Availability = 'available';
    static availabilityCalls: any[] = [];
    static created: FakeLM[] = [];
    static clones: FakeLM[] = [];
    static onPrompt: PromptFn = () => 'ok';
    static active = 0;
    static maxActive = 0;

    static async availability(opts: any) { FakeLM.availabilityCalls.push(opts); return FakeLM.availabilityValue; }
    static async create(opts: any) { const s = new FakeLM(opts); FakeLM.created.push(s); return s; }

    contextWindow = 1000;
    contextUsage = 40;
    destroyed = false;
    appended: any[] = [];
    constructor(readonly opts: any) { super(); }

    async clone() {
        const c = new FakeLM(this.opts);
        c.contextUsage = this.contextUsage;
        FakeLM.clones.push(c);
        return c;
    }
    async measureContextUsage(text: string, opts?: any) {
        const schema = opts?.responseConstraint && !opts.omitResponseConstraintInput ? JSON.stringify(opts.responseConstraint).length : 0;
        return Math.ceil((text.length + schema) / 4);
    }
    async prompt(text: string, opts: any) {
        FakeLM.active++;
        FakeLM.maxActive = Math.max(FakeLM.maxActive, FakeLM.active);
        try {
            const out = await FakeLM.onPrompt(text, opts, this);
            this.contextUsage += Math.ceil((text.length + out.length) / 4);
            return out;
        } finally { FakeLM.active--; }
    }
    promptStreaming(text: string, opts: any) {
        const parts = ['Hel', 'lo'];
        return new ReadableStream<string>({ start(c) { parts.forEach(p => c.enqueue(p)); c.close(); void text; void opts; } });
    }
    async append(messages: any) { this.appended.push(messages); }
    destroy() { this.destroyed = true; }
}

const domError = (name: string, message = name) => new DOMException(message, name);

beforeEach(() => {
    FakeLM.availabilityValue = 'available';
    FakeLM.availabilityCalls = [];
    FakeLM.created = [];
    FakeLM.clones = [];
    FakeLM.onPrompt = () => 'ok';
    FakeLM.active = 0;
    FakeLM.maxActive = 0;
    (globalThis as any).LanguageModel = FakeLM;
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
    modelHost.reset();
});
afterEach(() => { delete (globalThis as any).LanguageModel; delete (FakeLM.prototype as any).samplingMode; });

const call = (over: Record<string, unknown> = {}) => ({ system: 'S', prompt: 'read this', ...over });

describe('modelHost: sessions', () => {
    it('asks availability with the same options it creates with, and pins sampling for exact calls', async () => {
        const res = await modelHost.run(call({ sampling: 'exact' }));
        expect(res).toMatchObject({ ok: true, value: 'ok' });
        expect(FakeLM.availabilityCalls[0]).toEqual(MODEL_OPTIONS);
        const opts = FakeLM.created[0].opts;
        expect(opts.expectedInputs).toEqual(MODEL_OPTIONS.expectedInputs);
        expect(opts.initialPrompts).toEqual([{ role: 'system', content: 'S' }]);
        // Extensions: temperature and topK together, or neither.
        expect([opts.temperature, opts.topK]).toEqual([0, 1]);
    });

    it('uses samplingMode where Chrome has it, and nothing for default calls', async () => {
        (FakeLM.prototype as any).samplingMode = null;
        await modelHost.run(call({ sampling: 'exact' }));
        expect(FakeLM.created[0].opts).toMatchObject({ samplingMode: 'most-predictable' });
        expect(FakeLM.created[0].opts).not.toHaveProperty('temperature');
        await modelHost.run(call({ system: 'T' }));
        expect(FakeLM.created[1].opts).not.toHaveProperty('samplingMode');
        expect(FakeLM.created[1].opts).not.toHaveProperty('topK');
    });

    it('keeps one base per system prompt and runs every call in a clone it destroys', async () => {
        await modelHost.run(call());
        await modelHost.run(call());
        expect(FakeLM.created).toHaveLength(1);
        expect(FakeLM.clones).toHaveLength(2);
        expect(FakeLM.clones.every(c => c.destroyed)).toBe(true);
        // The base never accumulates history.
        expect(FakeLM.created[0].contextUsage).toBe(40);
        modelHost.reset();
        await Promise.resolve();
        expect(FakeLM.created[0].destroyed).toBe(true);
    });

    it('runs calls one at a time', async () => {
        FakeLM.onPrompt = async () => { await new Promise(r => setTimeout(r, 10)); return 'ok'; };
        await Promise.all([modelHost.run(call()), modelHost.run(call()), modelHost.run(call())]);
        expect(FakeLM.maxActive).toBe(1);
    });

    it('streams the answer', async () => {
        const seen: string[] = [];
        const res = await modelHost.run(call({ onText: (t: string) => seen.push(t) }));
        expect(res).toMatchObject({ ok: true, value: 'Hello' });
        expect(seen).toEqual(['Hel', 'Hello']);
    });
});

describe('modelHost: availability and activation', () => {
    it('reports unavailable with the requirements, and never creates a session', async () => {
        FakeLM.availabilityValue = 'unavailable';
        expect((await modelStatus()).reason).toMatch(/22 GB/);
        expect(await modelHost.run(call())).toMatchObject({ ok: false, code: 'model_unavailable' });
        expect(FakeLM.created).toHaveLength(0);
    });

    it('needs a click to download, and downloads from one', async () => {
        FakeLM.availabilityValue = 'downloadable';
        expect(await modelHost.prepare('S')).toMatchObject({ ok: false, code: 'needs_activation' });
        Object.defineProperty(navigator, 'userActivation', { value: { isActive: true }, configurable: true });
        expect(await modelHost.prepare('S')).toMatchObject({ ok: true });
        expect(FakeLM.created).toHaveLength(1);
    });

    it('treats a Chrome without the context-window API as unsupported', async () => {
        const old = FakeLM.prototype.measureContextUsage;
        delete (FakeLM.prototype as any).measureContextUsage;
        try {
            expect(modelSupported()).toBe(false);
            expect((await modelStatus()).availability).toBe('unavailable');
        } finally { FakeLM.prototype.measureContextUsage = old; }
    });
});

describe('modelHost: fitting the context window', () => {
    it('measures before sending: a prompt that does not fit is too_large and never sent', async () => {
        let sent = false;
        FakeLM.onPrompt = () => { sent = true; return 'ok'; };
        const res = await modelHost.run(call({ prompt: 'x'.repeat(4000) }));
        expect(res).toMatchObject({ ok: false, code: 'too_large', need: 1000 });
        expect(sent).toBe(false);
    });

    it('counts the response constraint unless it is omitted from the input', async () => {
        const schema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, { type: 'string', description: 'a long description of the field' }])) };
        const prompt = 'y'.repeat(1200);
        expect(await modelHost.run(call({ prompt, schema }))).toMatchObject({ ok: false, code: 'too_large' });
        expect(await modelHost.run(call({ prompt, schema, omitSchemaInput: true }))).toMatchObject({ ok: true });
    });

    it('room() reports free tokens and the measured characters per token', async () => {
        const room = await modelHost.room('S', 'default', 'abcd'.repeat(100), 100);
        expect(room).toEqual({ tokens: 1000 - 40 - 100, charsPerToken: 4 });
    });
});

describe('modelHost: errors by name (plan §3.9.5)', () => {
    const cases: [string, Error, string][] = [
        ['QuotaExceededError', domError('QuotaExceededError'), 'too_large'],
        ['NotSupportedError (schema)', domError('NotSupportedError', 'Unsupported JSON Schema keyword'), 'schema_unsupported'],
        ['NotSupportedError (language)', domError('NotSupportedError', 'Unsupported language'), 'unsupported_language'],
        ['SyntaxError', domError('SyntaxError'), 'unsatisfiable'],
        ['NetworkError', domError('NetworkError'), 'model_unavailable'],
        ['TypeError', new TypeError('bad option'), 'failed'],
        ['RangeError', new RangeError('topK'), 'failed'],
    ];
    for (const [name, error, code] of cases) {
        it(`${name} → ${code}`, async () => {
            FakeLM.onPrompt = () => { throw error; };
            expect(await modelHost.run(call())).toMatchObject({ ok: false, code });
            // Documented errors are never retried on a new session.
            expect(FakeLM.created).toHaveLength(1);
        });
    }

    it('a user abort is aborted; our timeout is timeout', async () => {
        const waitForAbort: PromptFn = (_t, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(domError('AbortError'))));
        FakeLM.onPrompt = waitForAbort;
        const user = new AbortController();
        const pending = modelHost.run(call(), user.signal);
        setTimeout(() => user.abort(), 5);
        expect(await pending).toMatchObject({ ok: false, code: 'aborted' });
        expect(await modelHost.run(call({ timeoutMs: 10 }))).toMatchObject({ ok: false, code: 'timeout' });
        expect(FakeLM.clones.every(c => c.destroyed)).toBe(true);
    });

    it('an answer the parser rejects is invalid_output', async () => {
        FakeLM.onPrompt = () => 'not json';
        expect(await modelHost.run(call({ parse: (raw: string) => JSON.parse(raw) }))).toMatchObject({ ok: false, code: 'invalid_output' });
    });

    it('an undocumented failure recreates the session once', async () => {
        let n = 0;
        FakeLM.onPrompt = () => { if (n++ === 0) throw new Error('model process gone'); return 'back'; };
        expect(await modelHost.run(call())).toMatchObject({ ok: true, value: 'back' });
        expect(FakeLM.created).toHaveLength(2);

        FakeLM.onPrompt = () => { throw new Error('still gone'); };
        expect(await modelHost.run(call())).toMatchObject({ ok: false, code: 'session_lost' });
    });

    it('codeFor leaves unknown errors to the recovery path', () => {
        expect(codeFor(new Error('x'))).toBeNull();
        expect(codeFor(domError('AbortError'))).toBe('aborted');
    });
});

describe('modelHost: conversations', () => {
    it('seeds with append (no fake assistant turn) and reports overflow', async () => {
        let overflowed = false;
        const opened = await modelHost.conversation('Chat', 'the document', { onOverflow: () => { overflowed = true; } });
        if ('code' in opened) throw new Error(opened.code);
        const session = opened.session as unknown as FakeLM;
        expect(session.opts.initialPrompts).toEqual([{ role: 'system', content: 'Chat' }]);
        expect(session.appended).toEqual([[{ role: 'user', content: 'the document' }]]);
        session.dispatchEvent(new Event('contextoverflow'));
        expect(overflowed).toBe(true);
    });

    it('runOn answers in a clone: the conversation is unchanged', async () => {
        const opened = await modelHost.conversation('Chat', 'doc');
        if ('code' in opened) throw new Error(opened.code);
        const session = opened.session as unknown as FakeLM;
        const before = session.contextUsage;
        FakeLM.onPrompt = () => '["a","b","c"]';
        const res = await modelHost.runOn(opened.session, { prompt: 'suggest', parse: raw => JSON.parse(raw) as string[] });
        expect(res).toMatchObject({ ok: true, value: ['a', 'b', 'c'] });
        expect(session.contextUsage).toBe(before);
    });
});
