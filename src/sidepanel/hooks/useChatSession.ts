import { useState, useRef, useEffect, useCallback } from 'react';
import type { ExtractedContent } from '@/shared/types/summarizer';
import { modelHost, modelSupported, CALL_ERROR_MESSAGES } from '../services/ai/modelHost';
import { truncateAtBoundary } from '../services/ai/chunking';

const CHAT_SYSTEM = 'You are an intelligent reading assistant. Answer concisely and strictly based on the Reference Document the user gave at the start of this conversation.';
// Exactly 3 strings as real JSON: the session's "answer only from the document" prompt otherwise
// makes the model answer in prose.
const SUGGESTIONS_SCHEMA = { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 };
/** Share of the context window the document may take; the rest is the conversation. */
const DOC_SHARE = 0.5;

export const QUICK_REPLIES = [
    "What are the key takeaways?",
    "What are the pros & cons?",
    "Show me a comparison table",
    "Explain it simply"
];

export interface ChatMessage {
    role: 'user' | 'model';
    content: string;
}

export interface ChatSessionApi {
    messages: ChatMessage[];
    isThinking: boolean;
    chatAvailable: boolean;
    dynamicReplies: string[];
    sendMessage(text: string): Promise<void>;
}

// Follow-up chat over the extracted document. The Prompt API session is
// created lazily on the FIRST message — users who only want the summary
// never pay the Prompt model warm-up.
export function useChatSession(doc: ExtractedContent | null, chunkDigest: string | null): ChatSessionApi {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [dynamicReplies, setDynamicReplies] = useState<string[]>(QUICK_REPLIES);

    const sessionRef = useRef<LanguageModel | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isMountedRef = useRef(true);
    // Read latest values inside the lazy creation without re-creating callbacks.
    const seedRef = useRef<{ doc: ExtractedContent | null; chunkDigest: string | null }>({ doc, chunkDigest });
    seedRef.current = { doc, chunkDigest };

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            abortControllerRef.current?.abort();
            sessionRef.current?.destroy();
            sessionRef.current = null;
        };
    }, []);

    const fetchSuggestions = async (contextText: string) => {
        // A clone of the live conversation: it sees the document and the turns so far, and its own
        // answer never lands in the chat history.
        const session = sessionRef.current;
        if (!session) return;
        const res = await modelHost.runOn(session, {
            prompt: `Based on the conversation so far and this latest reply, suggest exactly 3 short follow-up questions the user could ask next.\n\nLatest reply:\n${contextText.substring(0, 1500)}`,
            schema: SUGGESTIONS_SCHEMA,
            parse: raw => {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not a list');
                return parsed.slice(0, 3).map((q: unknown) => String(q).trim());
            },
        });
        if (!isMountedRef.current) return;
        if (res.ok) setDynamicReplies(res.value);
        else setDynamicReplies(QUICK_REPLIES);
    };

    const sendMessage = useCallback(async (text: string) => {
        const userMsg = text.trim();
        if (!userMsg || isThinking) return;

        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsThinking(true);

        try {
            if (!sessionRef.current) {
                const { doc: currentDoc, chunkDigest: digest } = seedRef.current;
                // Long docs seed the chat with the map-pass chunk summaries,
                // never the raw (potentially 80k-char) text.
                const seedDocument = digest ?? currentDoc?.text ?? '';
                const room = await modelHost.room(CHAT_SYSTEM, 'default', seedDocument);
                if ('code' in room) throw Object.assign(new Error(CALL_ERROR_MESSAGES[room.code]), { name: 'ModelError' });
                const reference = truncateAtBoundary(seedDocument, Math.floor(room.tokens * room.charsPerToken * DOC_SHARE));
                const opened = await modelHost.conversation(CHAT_SYSTEM, `Reference Document:\n---\n${reference}\n---\n\nAnswer all following questions strictly from this document.`, {
                    onOverflow: () => {
                        if (isMountedRef.current) setMessages(prev => [...prev, { role: 'model', content: '_Older messages no longer fit the on-device model and were forgotten; the document is kept._' }]);
                    },
                });
                if ('code' in opened) throw Object.assign(new Error(opened.detail && opened.code === 'model_unavailable' ? opened.detail : CALL_ERROR_MESSAGES[opened.code]), { name: 'ModelError' });
                sessionRef.current = opened.session;
            }

            const controller = new AbortController();
            abortControllerRef.current = controller;

            // No manual doc/history replay: the session already remembers the
            // Reference Document and every prior turn.
            const reader = sessionRef.current.promptStreaming(userMsg, { signal: controller.signal }).getReader();

            let full = '';
            setMessages(prev => [...prev, { role: 'model', content: '' }]);
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                full += value;
                if (!isMountedRef.current) return;
                setMessages(prev => {
                    const next = [...prev];
                    next[next.length - 1] = { role: 'model', content: full };
                    return next;
                });
            }

            fetchSuggestions(full);
        } catch (err: any) {
            if (!isMountedRef.current) return;
            if (err?.name === 'QuotaExceededError') {
                setMessages(prev => [...prev, { role: 'model', content: 'This conversation has grown too long for the on-device model to keep in context. Please go back and start a fresh summary.' }]);
            } else if (err?.name !== 'AbortError') {
                setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
            }
        } finally {
            if (isMountedRef.current) setIsThinking(false);
        }
    }, [isThinking]);

    return {
        messages,
        isThinking,
        chatAvailable: modelSupported(),
        dynamicReplies,
        sendMessage
    };
}
