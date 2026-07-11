import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Paper, TextField, IconButton, CircularProgress, Button, LinearProgress, Chip } from '@mui/material';
import { Send, Bot, User, Download, RefreshCw, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const QUICK_REPLIES = [
    "What are the key takeaways?",
    "What are the pros & cons?",
    "Show me a comparison table",
    "Explain it simply"
];

const SYSTEM_PROMPT = 'You are an intelligent reading assistant. Answer concisely and strictly based on the Reference Document provided at the start of this conversation.';

// Rough chars-per-token for Gemini Nano; used to keep the doc + ongoing
// conversation inside the session's context window without a hard, blind cut.
const CHARS_PER_TOKEN = 4;
const DEFAULT_DOC_CHAR_BUDGET = 12000;

// Forces the model to return exactly 3 strings as real JSON, regardless of
// the session's "answer strictly from the document" system prompt — without
// this, the model often refuses/answers in prose and the regex-based parse
// below silently fails, leaving the suggestions stuck on the static defaults.
const SUGGESTIONS_SCHEMA = {
    type: 'array',
    items: { type: 'string' },
    minItems: 3,
    maxItems: 3
};

interface Step2SummaryChatProps {
    selectedText: string;
    onBack: () => void;
}

interface ChatMessage {
    role: 'user' | 'model';
    content: string;
}

function getLanguageModel(): any {
    const aiAPI = (chrome as any).aiOriginTrial || (window as any).ai;
    return aiAPI?.languageModel || (window as any).LanguageModel;
}

// Truncate on a sentence/paragraph boundary rather than mid-word, so the
// model doesn't receive a fact cut off halfway through.
function truncateAtBoundary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const lastBoundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
    return lastBoundary > maxChars * 0.5 ? slice.slice(0, lastBoundary + 1) : slice;
}

export function Step2SummaryChat({ selectedText, onBack }: Step2SummaryChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [dynamicReplies, setDynamicReplies] = useState<string[]>(QUICK_REPLIES);

    const [aiStatus, setAiStatus] = useState<'checking' | 'ready' | 'downloading' | 'unavailable' | 'error'>('checking');
    const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    // A single long-lived session holds the Reference Document + the entire
    // conversation. Chrome's Prompt API tracks this state internally, so we
    // never need to re-send the document or replay history by hand.
    const sessionRef = useRef<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isMountedRef = useRef(true);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
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
            } catch (constraintErr) {
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
            if (suggestionSession && typeof suggestionSession.destroy === 'function') {
                suggestionSession.destroy();
            }
        }
    };

    // Initial AI Check & Summarization
    useEffect(() => {
        let isMounted = true;

        const initializeAI = async () => {
            const LanguageModel = getLanguageModel();

            if (!LanguageModel) {
                if (isMounted) {
                    setAiStatus('unavailable');
                    setErrorMessage('Chrome AI Prompt API is not available. Please ensure flags #prompt-api-for-extension and #optimization-guide-on-device-model are enabled, and you are using Chrome 128+.');
                }
                return;
            }

            try {
                const availability = await LanguageModel.availability();

                if (availability === 'no') {
                    if (isMounted) {
                        setAiStatus('unavailable');
                        setErrorMessage('The language model is not available on this device.');
                    }
                    return;
                }

                const monitor = (m: any) => {
                    m.addEventListener('downloadprogress', (e: any) => {
                        if (isMounted) setDownloadProgress({ loaded: e.loaded, total: e.total });
                    });
                };

                if (availability === 'after-download' && isMounted) {
                    setAiStatus('downloading');
                }

                // Create exactly one session for the lifetime of this wizard step.
                const session = await LanguageModel.create({
                    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
                    ...(availability === 'after-download' ? { monitor } : {})
                });

                if (!isMounted) {
                    session.destroy?.();
                    return;
                }

                sessionRef.current = session;
                setAiStatus('ready');
                await generateInitialSummary(session);
            } catch (err: any) {
                console.error("AI Init Error:", err);
                if (isMounted) {
                    setAiStatus('error');
                    setErrorMessage(err.message || 'Failed to initialize AI session.');
                }
            }
        };

        const generateInitialSummary = async (session: any) => {
            setIsThinking(true);
            try {
                const budget = docCharBudget(session);
                const docContext = truncateAtBoundary(selectedText, budget);
                const promptString = `Reference Document:\n---\n${docContext}\n---\n\nPlease provide a structured, concise summary of the document.`;

                const controller = new AbortController();
                abortControllerRef.current = controller;

                const stream = session.promptStreaming(promptString, { signal: controller.signal });
                setMessages([{ role: 'model', content: '' }]);

                let full = '';
                for await (const chunk of stream) {
                    full += chunk;
                    if (isMounted) {
                        setMessages([{ role: 'model', content: full }]);
                    }
                }

                if (isMounted) {
                    fetchSuggestions(full);
                }
            } catch (err: any) {
                if (isMounted) {
                    setMessages([{ role: 'model', content: `Error generating summary: ${err.message}` }]);
                }
            } finally {
                if (isMounted) {
                    setIsThinking(false);
                }
            }
        };

        initializeAI();

        return () => {
            isMounted = false;
            abortControllerRef.current?.abort();
            if (sessionRef.current && typeof sessionRef.current.destroy === 'function') {
                sessionRef.current.destroy();
            }
            sessionRef.current = null;
        };
    }, [selectedText]);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    // Leaves headroom for the doc + ongoing conversation inside the
    // session's actual context window, instead of a blind 8000-char cut.
    const docCharBudget = (session: any): number => {
        const quota = session?.inputQuota;
        if (typeof quota === 'number' && quota > 0) {
            return Math.max(4000, Math.floor(quota * CHARS_PER_TOKEN * 0.6));
        }
        return DEFAULT_DOC_CHAR_BUDGET;
    };

    const handleSendMessage = async (customMessage?: string) => {
        const userMsg = typeof customMessage === 'string' ? customMessage : input.trim();
        const session = sessionRef.current;
        if (!userMsg || !session || isThinking) return;

        if (typeof customMessage !== 'string') setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsThinking(true);

        try {
            const controller = new AbortController();
            abortControllerRef.current = controller;

            // No manual doc/history replay: the session already remembers the
            // Reference Document and every prior turn.
            const stream = session.promptStreaming(userMsg, { signal: controller.signal });

            let full = '';
            setMessages(prev => [...prev, { role: 'model', content: '' }]);
            for await (const chunk of stream) {
                full += chunk;
                setMessages(prev => {
                    const next = [...prev];
                    next[next.length - 1] = { role: 'model', content: full };
                    return next;
                });
            }

            fetchSuggestions(full);
        } catch (err: any) {
            if (err?.name === 'QuotaExceededError') {
                setMessages(prev => [...prev, { role: 'model', content: 'This conversation has grown too long for the on-device model to keep in context. Please go back and start a fresh summary.' }]);
            } else {
                setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
            }
        } finally {
            setIsThinking(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    if (aiStatus === 'checking') {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 2 }}>
                <CircularProgress size={40} />
                <Typography variant="body1" color="text.secondary">Checking AI model availability...</Typography>
            </Box>
        );
    }

    if (aiStatus === 'downloading') {
        const percent = downloadProgress && downloadProgress.total > 0
            ? Math.round((downloadProgress.loaded / downloadProgress.total) * 100)
            : 0;

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 3 }}>
                <Box sx={{ p: 2, bgcolor: 'primary.light', borderRadius: '50%', color: 'primary.main', opacity: 0.1, position: 'absolute' }}>
                    <Download size={64} />
                </Box>
                <Download size={48} className="text-blue-500 z-10" />

                <Typography variant="h6">Downloading Language Model</Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center" maxWidth={300}>
                    Chrome is downloading the required AI model for your device. This only happens once.
                </Typography>

                <Box sx={{ width: '100%', maxWidth: 400, mt: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">Progress</Typography>
                        <Typography variant="caption" fontWeight="bold">{percent}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={percent} sx={{ height: 8, borderRadius: 4 }} />
                    {downloadProgress && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
                            {Math.round(downloadProgress.loaded / 1024 / 1024)} MB / {Math.round(downloadProgress.total / 1024 / 1024)} MB
                        </Typography>
                    )}
                </Box>
            </Box>
        );
    }

    if (aiStatus === 'unavailable' || aiStatus === 'error') {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="error" gutterBottom>{errorMessage}</Typography>
                <Button variant="outlined" onClick={onBack} sx={{ mt: 2 }}>Go Back</Button>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>

            {/* Chat History Area */}
            <Paper
                elevation={0}
                sx={{
                    flex: 1,
                    overflowY: 'auto',
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    bgcolor: 'background.default',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2
                }}
            >
                <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    p: 1.5, borderRadius: 2, mb: 1,
                    background: 'linear-gradient(90deg, rgba(88,101,242,0.1) 0%, rgba(138,43,226,0.1) 100%)',
                    border: '1px solid', borderColor: 'primary.light'
                }}>
                    <Box sx={{ p: 0.75, borderRadius: 1.5, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex' }}>
                        <Sparkles size={16} />
                    </Box>
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'primary.dark', lineHeight: 1.2 }}>Powered by Gemini Nano</Typography>
                        <Typography variant="caption" color="text.secondary">Running 100% on-device for maximum privacy and speed.</Typography>
                    </Box>
                </Box>

                {messages.length === 0 && isThinking && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, color: 'text.secondary' }}>
                        <RefreshCw size={16} className="animate-spin" />
                        <Typography variant="body2">Generating initial summary...</Typography>
                    </Box>
                )}

                {messages.map((msg, index) => (
                    <Box
                        key={index}
                        sx={{
                            display: 'flex',
                            gap: 1.5,
                            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                            alignItems: 'flex-start'
                        }}
                    >
                        {/* Avatar */}
                        <Box sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: msg.role === 'user' ? 'primary.main' : 'secondary.main',
                            color: 'white',
                            flexShrink: 0
                        }}>
                            {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                        </Box>

                        {/* Message Bubble */}
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2,
                                px: 2.5,
                                borderRadius: 3,
                                borderTopRightRadius: msg.role === 'user' ? 1 : undefined,
                                borderTopLeftRadius: msg.role === 'model' ? 1 : undefined,
                                bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                                color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                                border: msg.role === 'model' ? '1px solid' : 'none',
                                borderColor: 'divider',
                                maxWidth: '85%',
                                fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                                boxShadow: msg.role === 'model'
                                    ? '0 2px 8px rgba(0,0,0,0.04)'
                                    : '0 4px 12px rgba(var(--mui-palette-primary-mainChannel) / 0.25)',
                                '& p': {
                                    m: 0,
                                    mb: 1.5,
                                    '&:last-child': { mb: 0 },
                                    fontSize: '0.95rem',
                                    lineHeight: 1.6,
                                    letterSpacing: '0.01em',
                                    color: msg.role === 'user' ? 'inherit' : 'text.secondary'
                                },
                                '& strong': {
                                    fontWeight: 600,
                                    color: msg.role === 'user' ? 'inherit' : 'text.primary'
                                },
                                '& ul, & ol': { m: 0, pl: 2.5, mb: 1.5 },
                                '& li': {
                                    mb: 0.5,
                                    fontSize: '0.95rem',
                                    lineHeight: 1.6,
                                    color: msg.role === 'user' ? 'inherit' : 'text.secondary'
                                },
                                '& table': { borderCollapse: 'collapse', width: '100%', mb: 1.5, fontSize: '0.9rem' },
                                '& th, & td': { border: '1px solid', borderColor: 'divider', p: 1, textAlign: 'left' },
                                '& th': { backgroundColor: 'action.hover', fontWeight: 600, color: 'text.primary' },
                                '& a': { color: 'primary.light', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }
                            }}
                        >
                            {msg.role === 'model' ? (
                                <Box sx={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowX: 'auto' }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || ' '}</ReactMarkdown>
                                </Box>
                            ) : (
                                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: 1.6 }}>
                                    {msg.content}
                                </Typography>
                            )}
                        </Paper>
                    </Box>
                ))}

                {isThinking && messages.length > 0 && messages[messages.length - 1]?.content === '' && (
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1 }}>
                        <Box sx={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'secondary.main', color: 'white' }}>
                            <Bot size={18} />
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={12} color="inherit" /> Thinking...
                        </Typography>
                    </Box>
                )}

                {messages.length > 0 && !isThinking && messages[messages.length - 1].role === 'model' && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1, pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mb: 0.5 }}>Suggested follow-ups:</Typography>
                        {dynamicReplies.map((reply) => (
                            <Chip
                                key={reply}
                                label={reply}
                                onClick={() => handleSendMessage(reply)}
                                variant="outlined"
                                color="primary"
                                sx={{ borderRadius: 2, '&:hover': { bgcolor: 'primary.main', color: 'white' } }}
                            />
                        ))}
                    </Box>
                )}

                <div ref={messagesEndRef} />
            </Paper>

            {/* Input Area */}
            <Paper elevation={0} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                <TextField
                    fullWidth
                    placeholder="Ask a follow-up question..."
                    multiline
                    maxRows={4}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isThinking || aiStatus !== 'ready'}
                    variant="standard"
                    InputProps={{
                        disableUnderline: true,
                        sx: { p: 1, fontSize: '0.9rem' }
                    }}
                />
                <IconButton
                    color="primary"
                    onClick={() => handleSendMessage()}
                    disabled={!input.trim() || isThinking || aiStatus !== 'ready'}
                    sx={{ p: 1.5, mb: 0.5 }}
                >
                    <Send size={18} />
                </IconButton>
            </Paper>
        </Box>
    );
}
