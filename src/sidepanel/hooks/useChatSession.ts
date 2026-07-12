import { useState, useRef, useEffect, useCallback } from 'react';
import type { ExtractedContent } from '@/shared/types/summarizer';
import { createChatSession, isPromptApiSupported, SUGGESTIONS_SCHEMA } from '../services/ai/promptSession';

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

    const sessionRef = useRef<any>(null);
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
            sessionRef.current?.destroy?.();
            sessionRef.current = null;
        };
    }, []);

    const fetchSuggestions = async (contextText: string) => {
        // Clone the live session instead of creating a new one from scratch:
        // the clone inherits the Reference Document context for free (no
        // resend) and its own conversation branch, so it can't pollute or
        // desync the main chat history.
        const baseSession = sessionRef.current;
        if (!baseSession || typeof baseSession.clone !== 'function') return;

        const promptText = `Based on the conversation so far and this latest reply, suggest exactly 3 short follow-up questions the user could ask next.\n\nLatest reply:\n${contextText.substring(0, 1500)}`;

        let suggestionSession: any = null;
        try {
            suggestionSession = await baseSession.clone();

            let resp: string;
            try {
                // Structured output: guarantees a real JSON array back even
                // though the cloned session's system prompt says to only
                // answer from the document.
                resp = await suggestionSession.prompt(promptText, { responseConstraint: SUGGESTIONS_SCHEMA });
            } catch {
                // Older Chrome without responseConstraint support — fall
                // back to asking for JSON in plain text and parsing loosely.
                resp = await suggestionSession.prompt(
                    `${promptText}\n\nReturn ONLY a valid JSON array of strings, nothing else.`
                );
            }

            if (!isMountedRef.current) return;

            const jsonMatch = resp.match(/\[([\s\S]*?)\]/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : resp);
            if (Array.isArray(parsed) && parsed.length > 0) {
                setDynamicReplies(parsed.slice(0, 3).map((s: string) => String(s).trim()));
            }
        } catch (e) {
            console.error('Failed to generate suggestions:', e);
            if (isMountedRef.current) setDynamicReplies(QUICK_REPLIES);
        } finally {
            suggestionSession?.destroy?.();
        }
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
                sessionRef.current = await createChatSession({ seedDocument });
            }

            const controller = new AbortController();
            abortControllerRef.current = controller;

            // No manual doc/history replay: the session already remembers the
            // Reference Document and every prior turn.
            const stream = sessionRef.current.promptStreaming(userMsg, { signal: controller.signal });

            let full = '';
            setMessages(prev => [...prev, { role: 'model', content: '' }]);
            for await (const chunk of stream) {
                full += chunk;
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
        chatAvailable: isPromptApiSupported(),
        dynamicReplies,
        sendMessage
    };
}
