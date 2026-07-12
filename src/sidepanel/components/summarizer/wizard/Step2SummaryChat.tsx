import { useState, useEffect, useRef } from 'react';
import { Box, Typography, Paper, TextField, IconButton, CircularProgress, Button, LinearProgress } from '@mui/material';
import { Send, Bot, User, Download, RefreshCw, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Chip } from '@mui/material';
import type { ExtractedContent } from '@/shared/types/summarizer';
import { useSummaryEngine } from '../../../hooks/useSummaryEngine';
import { useChatSession, type ChatMessage } from '../../../hooks/useChatSession';
import { SummaryControls } from '../SummaryControls';

interface Step2SummaryChatProps {
    doc: ExtractedContent | null;
    onBack: () => void;
}

export function Step2SummaryChat({ doc, onBack }: Step2SummaryChatProps) {
    const engine = useSummaryEngine(doc);
    const chat = useChatSession(doc, engine.chunkDigest);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const summaryStarted = engine.phase === 'streaming' || engine.phase === 'ready' || engine.phase === 'mapping';
    const messages: ChatMessage[] = [
        ...(engine.summary || engine.phase === 'streaming' ? [{ role: 'model' as const, content: engine.summary }] : []),
        ...chat.messages
    ];
    const isBusy = chat.isThinking || engine.phase === 'streaming' || engine.phase === 'mapping';
    const inputDisabled = !doc || !chat.chatAvailable || isBusy || engine.phase === 'downloading';

    // Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, engine.summary, chat.isThinking]);

    const handleSend = (customMessage?: string) => {
        const text = typeof customMessage === 'string' ? customMessage : input.trim();
        if (!text || inputDisabled) return;
        if (typeof customMessage !== 'string') setInput('');
        chat.sendMessage(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (engine.phase === 'checking' || engine.phase === 'idle') {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 2 }}>
                <CircularProgress size={40} />
                <Typography variant="body1" color="text.secondary">Checking AI model availability...</Typography>
            </Box>
        );
    }

    if (engine.phase === 'downloading') {
        const percent = engine.downloadProgress !== null ? Math.round(engine.downloadProgress * 100) : 0;

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
                </Box>
            </Box>
        );
    }

    if (engine.phase === 'needs-activation') {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 2, textAlign: 'center' }}>
                <Download size={48} className="text-blue-500" />
                <Typography variant="h6">AI model download required</Typography>
                <Typography variant="body2" color="text.secondary" maxWidth={320}>
                    Chrome needs your permission to download the on-device AI model. This only happens once.
                </Typography>
                <Button variant="contained" onClick={engine.retryDownload} sx={{ mt: 1 }}>Download AI model</Button>
                <Button variant="text" onClick={onBack}>Go Back</Button>
            </Box>
        );
    }

    if (engine.phase === 'unavailable' || engine.phase === 'error') {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="error" gutterBottom>{engine.error}</Typography>
                <Button variant="outlined" onClick={onBack} sx={{ mt: 2 }}>Go Back</Button>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>

            {summaryStarted && (
                <SummaryControls
                    type={engine.type}
                    length={engine.length}
                    disabled={false}
                    onChange={engine.setOptions}
                />
            )}

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

                {engine.phase === 'mapping' && engine.chunkProgress && (
                    <Box sx={{ p: 1.5, borderRadius: 2, border: '1px dashed', borderColor: 'divider' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Long page detected — summarizing part {engine.chunkProgress.current} of {engine.chunkProgress.total}…
                        </Typography>
                        <LinearProgress
                            variant="determinate"
                            value={((engine.chunkProgress.current - 1) / engine.chunkProgress.total) * 100}
                            sx={{ height: 6, borderRadius: 3 }}
                        />
                    </Box>
                )}

                {messages.length === 0 && engine.phase === 'streaming' && (
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

                {chat.isThinking && messages[messages.length - 1]?.content === '' && (
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1 }}>
                        <Box sx={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'secondary.main', color: 'white' }}>
                            <Bot size={18} />
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={12} color="inherit" /> Thinking...
                        </Typography>
                    </Box>
                )}

                {chat.chatAvailable && messages.length > 0 && !isBusy && messages[messages.length - 1].role === 'model' && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1, pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mb: 0.5 }}>Suggested follow-ups:</Typography>
                        {chat.dynamicReplies.map((reply) => (
                            <Chip
                                key={reply}
                                label={reply}
                                onClick={() => handleSend(reply)}
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
            <Paper elevation={0} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                    <TextField
                        fullWidth
                        placeholder="Ask a follow-up question..."
                        multiline
                        maxRows={4}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={inputDisabled}
                        variant="standard"
                        InputProps={{
                            disableUnderline: true,
                            sx: { p: 1, fontSize: '0.9rem' }
                        }}
                    />
                    <IconButton
                        color="primary"
                        onClick={() => handleSend()}
                        disabled={!input.trim() || inputDisabled}
                        sx={{ p: 1.5, mb: 0.5 }}
                    >
                        <Send size={18} />
                    </IconButton>
                </Box>
                {!chat.chatAvailable && (
                    <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 0.5 }}>
                        Follow-up chat requires Chrome's Prompt API.
                    </Typography>
                )}
            </Paper>
        </Box>
    );
}
