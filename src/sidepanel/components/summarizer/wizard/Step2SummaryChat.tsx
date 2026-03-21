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

interface Step2SummaryChatProps {
    selectedText: string;
    onBack: () => void;
}

interface ChatMessage {
    role: 'user' | 'model';
    content: string;
}

export function Step2SummaryChat({ selectedText, onBack }: Step2SummaryChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [dynamicReplies, setDynamicReplies] = useState<string[]>(QUICK_REPLIES);

    const [aiStatus, setAiStatus] = useState<'checking' | 'ready' | 'downloading' | 'unavailable' | 'error'>('checking');
    const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    const sessionRef = useRef<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    const fetchSuggestions = async (contextText: string) => {
        const aiAPI = (chrome as any).aiOriginTrial || (window as any).ai;
        const LanguageModel = aiAPI?.languageModel || (window as any).LanguageModel;
        if (!LanguageModel) return;

        try {
            const tempSession = await LanguageModel.create({
                systemPrompt: `You are a helpful assistant. Provide exactly 3 short follow-up questions the user could ask based on the provided text. Return ONLY a valid JSON array of strings.`
            });
            const resp = await tempSession.prompt(`Generate follow-up questions for this text:\n\n${contextText.substring(0, 1500)}`);
            if (typeof tempSession.destroy === 'function') tempSession.destroy();
            
            if (!isMountedRef.current) return;

            const jsonMatch = resp.match(/\[([\s\S]*?)\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setDynamicReplies(parsed.slice(0, 3).map((s: string) => s.trim()));
                }
            }
        } catch (e) {
            console.error('Failed to generate suggestions:', e);
            if (isMountedRef.current) setDynamicReplies(QUICK_REPLIES);
        }
    };

    // Initial AI Check & Summarization
    useEffect(() => {
        let isMounted = true;

        const initializeAI = async () => {
            const aiAPI = (chrome as any).aiOriginTrial || (window as any).ai;

            const LanguageModel = aiAPI?.languageModel || (window as any).LanguageModel;

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

                if (availability === 'after-download') {
                    if (isMounted) {
                        setAiStatus('downloading');
                    }
                    // Start download by creating a temporary session
                    const tempSession = await LanguageModel.create({
                        systemPrompt: `You are an intelligent reading assistant. Answer concisely and strictly based on the provided Reference Document context.`,
                        monitor(m: any) {
                            m.addEventListener('downloadprogress', (e: any) => {
                                if (isMounted) {
                                    setDownloadProgress({ loaded: e.loaded, total: e.total });
                                }
                            });
                        }
                    });

                    if (isMounted) {
                        setAiStatus('ready');
                        await generateInitialSummary(tempSession);
                    }
                } else {
                    if (isMounted) {
                        setAiStatus('ready');
                    }
                    const newSession = await LanguageModel.create({
                        systemPrompt: `You are an intelligent reading assistant. Answer concisely and strictly based on the provided Reference Document context.`
                    });
                    if (isMounted) {
                        await generateInitialSummary(newSession);
                    }
                }
            } catch (err: any) {
                console.error("AI Init Error:", err);
                if (isMounted) {
                    setAiStatus('error');
                    setErrorMessage(err.message || 'Failed to initialize AI session.');
                }
            }
        };

        const generateInitialSummary = async (baseSession: any) => {
            sessionRef.current = baseSession;
            setIsThinking(true);
            try {
                const aiAPI = (chrome as any).aiOriginTrial || (window as any).ai;
                const LanguageModel = aiAPI?.languageModel || (window as any).LanguageModel;
                
                const tempSession = await LanguageModel.create({
                    systemPrompt: 'You are an intelligent reading assistant. Answer concisely and strictly based on the provided Reference Document context.'
                });
                
                const docContext = selectedText.substring(0, 8000); 
                const promptString = `Reference Document:\n---\n${docContext}\n---\n\nPlease provide a structured, concise summary of the document.`;
                
                const summary = await tempSession.prompt(promptString);
                if (typeof tempSession.destroy === 'function') tempSession.destroy();

                if (isMounted) {
                    setMessages([{ role: 'model', content: summary }]);
                    fetchSuggestions(summary);
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
            // Cleanup session if possible
            if (sessionRef.current && typeof sessionRef.current.destroy === 'function') {
                sessionRef.current.destroy();
            }
        };
    }, [selectedText]);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    const handleSendMessage = async (customMessage?: string) => {
        const userMsg = typeof customMessage === 'string' ? customMessage : input.trim();
        if (!userMsg || !sessionRef.current || isThinking) return;

        if (typeof customMessage !== 'string') setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsThinking(true);

        try {
            const aiAPI = (chrome as any).aiOriginTrial || (window as any).ai;
            const LanguageModel = aiAPI?.languageModel || (window as any).LanguageModel;
            
            const tempSession = await LanguageModel.create({
                systemPrompt: 'You are an intelligent reading assistant. Answer concisely and strictly based on the provided Reference Document context.'
            });

            const docContext = selectedText.substring(0, 8000);
            let promptString = `Reference Document:\n---\n${docContext}\n---\n\n`;
            
            if (messages.length > 0) {
                promptString += `Previous Conversation:\n`;
                messages.forEach(m => {
                    promptString += `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}\n`;
                });
                promptString += `\n`;
            }
            promptString += `User's next question: ${userMsg}\nAnswer directly based on the Reference Document.`;

            const response = await tempSession.prompt(promptString);
            if (typeof tempSession.destroy === 'function') tempSession.destroy();

            setMessages(prev => [...prev, { role: 'model', content: response }]);
            
            // Re-generate suggestions dynamically based on new response
            fetchSuggestions(response);
        } catch (err: any) {
            setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
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
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                </Box>
                            ) : (
                                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: 1.6 }}>
                                    {msg.content}
                                </Typography>
                            )}
                        </Paper>
                    </Box>
                ))}

                {isThinking && messages.length > 0 && (
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
