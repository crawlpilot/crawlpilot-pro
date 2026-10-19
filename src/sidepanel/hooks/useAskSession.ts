/**
 * Questions about the page (docs/plans/summarize-ask-plan.md A2): a conversation seeded with the
 * page's view (blocks with refs), answers that cite blocks after each sentence, and each answer's
 * sentences checked against the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { modelHost, CALL_ERROR_MESSAGES } from '../services/ai/modelHost';
import { askReference, type AssistantPage } from '../services/ai/assistant';
import { ASK_SYSTEM, parseTable, tablePrompt, tableSchema, type AnswerTable } from '../../shared/ai/brief';
import { citedSentences, type CiteStatus } from '../../shared/ai/cite';
import type { PageView } from '../../shared/ai/page';

const SUGGESTIONS_SCHEMA = { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 };

export interface AskMessage {
    role: 'user' | 'model';
    content: string;
    /** Model answers: the check of the sentence each citation marker belongs to, in marker order. */
    markers?: CiteStatus[];
    /** Model answers: sentences the page doesn't support. */
    unsupported?: number;
    /** Still being written. */
    streaming?: boolean;
    /** "As a table": the answer's items as rows, each row checked against the page. */
    table?: { data: AnswerTable; rows: CiteStatus[] };
    tabling?: boolean;
    tableError?: string;
}

export interface AskSessionApi {
    messages: AskMessage[];
    thinking: boolean;
    suggestions: string[];
    ask(question: string): void;
    /** Turns the answer at `index` into a table of rows copied from the page. */
    asTable(index: number): void;
}

export function useAskSession(view: PageView | null, page: AssistantPage | null, starters: string[]): AskSessionApi {
    const [messages, setMessages] = useState<AskMessage[]>([]);
    const [thinking, setThinking] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>(starters);
    const session = useRef<LanguageModel | null>(null);
    const mounted = useRef(true);

    // A new page (a new view): a new conversation.
    useEffect(() => {
        mounted.current = true;
        setMessages([]);
        setSuggestions(starters);
        return () => {
            mounted.current = false;
            session.current?.destroy();
            session.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    const update = (fn: (last: AskMessage) => AskMessage) => setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
    });

    const ask = useCallback(async (question: string) => {
        const q = question.trim();
        if (!q || thinking || !view) return;
        setMessages(prev => [...prev, { role: 'user', content: q }, { role: 'model', content: '', streaming: true }]);
        setThinking(true);
        try {
            if (!session.current) {
                const reference = await askReference(view, ASK_SYSTEM);
                if (typeof reference !== 'string') throw new Error(CALL_ERROR_MESSAGES[reference.code]);
                const opened = await modelHost.conversation(ASK_SYSTEM, `<page>\n${reference}\n</page>\n\nAnswer the following questions from this page.`, {
                    onOverflow: () => { if (mounted.current) setMessages(prev => [...prev.slice(0, -1), { role: 'model', content: '_Older questions no longer fit the on-device model and were forgotten; the page is kept._' }, prev[prev.length - 1]]); },
                });
                if ('code' in opened) throw new Error(opened.code === 'model_unavailable' && opened.detail ? opened.detail : CALL_ERROR_MESSAGES[opened.code]);
                session.current = opened.session;
            }
            const reader = session.current.promptStreaming(q).getReader();
            let full = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                full += value;
                if (!mounted.current) return;
                update(m => ({ ...m, content: full }));
            }
            update(m => ({ ...m, streaming: false }));

            // Each sentence against the blocks it cites.
            const sentences = citedSentences(full);
            if (page && sentences.length > 0 && !/^the page doesn'?t say/i.test(full.trim())) {
                const results = await page.check(sentences.map((s, i) => ({ key: String(i), text: s.text, refs: s.refs }))).catch(() => []);
                const markers: CiteStatus[] = [];
                let unsupported = 0;
                results.forEach((r, i) => {
                    if (r.status === 'not_on_page') unsupported++;
                    for (let k = 0; k < sentences[i].refs.length; k++) markers.push(r.status);
                });
                if (mounted.current) update(m => ({ ...m, markers, unsupported }));
            }
            void suggestNext(full);
        } catch (e: any) {
            if (!mounted.current) return;
            const text = e?.name === 'QuotaExceededError'
                ? 'This conversation is too long for the on-device model. Brief the page again to start a new one.'
                : `Error: ${e?.message ?? e}`;
            update(() => ({ role: 'model', content: text }));
        } finally {
            if (mounted.current) setThinking(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thinking, view, page]);

    const suggestNext = async (answer: string) => {
        const s = session.current;
        if (!s) return;
        const res = await modelHost.runOn(s, {
            prompt: `Suggest exactly 3 short follow-up questions about this page the user could ask next, different from those asked so far.\n\nLatest answer:\n${answer.slice(0, 1200)}`,
            schema: SUGGESTIONS_SCHEMA,
            parse: raw => {
                const list = JSON.parse(raw);
                if (!Array.isArray(list) || list.length === 0) throw new Error('not a list');
                return list.slice(0, 3).map((q: unknown) => String(q).trim()).filter(Boolean);
            },
        });
        if (mounted.current && res.ok && res.value.length > 0) setSuggestions(res.value);
    };

    const asTable = useCallback(async (index: number) => {
        const s = session.current;
        const question = [...messages.slice(0, index)].reverse().find(m => m.role === 'user')?.content;
        if (!s || !question || thinking) return;
        const set = (patch: Partial<AskMessage>) => setMessages(prev => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
        set({ tabling: true, tableError: undefined });
        // A clone of the conversation: it knows the page and the answer, and the table doesn't join the history.
        const res = await modelHost.runOn(s, { prompt: tablePrompt(question), schema: tableSchema(), parse: parseTable, timeoutMs: 90_000 });
        if (!mounted.current) return;
        if (!res.ok) { set({ tabling: false, tableError: res.code === 'invalid_output' ? "The answer couldn't be made into a table." : CALL_ERROR_MESSAGES[res.code] }); return; }
        const results = page ? await page.check(res.value.rows.map((r, i) => ({ key: String(i), text: r.cells.join(' '), refs: r.ref ? [r.ref] : [] }))).catch(() => []) : [];
        if (!mounted.current) return;
        set({ tabling: false, table: { data: res.value, rows: res.value.rows.map((_, i) => results[i]?.status ?? 'unchecked') } });
    }, [messages, thinking, page]);

    return { messages, thinking, suggestions, ask, asTable };
}
