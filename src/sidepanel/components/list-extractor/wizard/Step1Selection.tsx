import { useEffect, useState } from 'react';
import { MousePointer2, Plus } from 'lucide-react';
import { Box, Button, Typography, Paper, Stack } from '@mui/material';
import { SelectorCard } from '../SelectorCard';
import { SelectorState } from '../../../../shared/types/extraction';

const HINT_KEY = 'crawlpilot_list_hint_seen';

interface Step1SelectionProps {
    selectors: SelectorState[];
    selectionStatus?: 'idle' | 'selecting' | 'ready';
    selectingFor: string | null;
    onStartSelection: () => void;
    onRemoveSelector: (id: string) => void;
    onUpdateSelector: (id: string, updates: Partial<SelectorState>) => void;
    onTestSelector: (selector: string) => void;
    onNext: () => void;
    onCancel?: () => void;
}

export function Step1Selection({
    selectors,
    selectionStatus = 'idle',
    selectingFor,
    onStartSelection,
    onRemoveSelector,
    onUpdateSelector,
    onTestSelector,
    onNext,
    onCancel
}: Step1SelectionProps) {

    const hasSelection = selectors.length > 0;
    const [showHint, setShowHint] = useState(() => !localStorage.getItem(HINT_KEY));

    useEffect(() => {
        if (hasSelection && showHint) {
            localStorage.setItem(HINT_KEY, '1');
            setShowHint(false);
        }
    }, [hasSelection, showHint]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Instruction / Empty State */}
            {!hasSelection && selectionStatus !== 'selecting' && (
                <Paper
                    elevation={0}
                    sx={{
                        p: 4,
                        textAlign: 'center',
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        borderRadius: 3
                    }}
                >
                    <Box sx={{
                        width: 64,
                        height: 64,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mb: 3,
                        boxShadow: '0 8px 16px -4px rgba(37, 99, 235, 0.2)'
                    }}>
                        <MousePointer2 size={32} />
                    </Box>

                    <Typography variant="h6" gutterBottom fontWeight="600">
                        Pick a Repeating Item
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph sx={{ maxWidth: 280, mx: 'auto', mb: 3 }}>
                        Click any item in the list or table you want to scrape — we'll detect the pattern and find all similar items automatically.
                    </Typography>

                    <Button
                        variant="contained"
                        size="large"
                        onClick={onStartSelection}
                        startIcon={<MousePointer2 size={18} />}
                        sx={{ borderRadius: 2, px: 4, py: 1.5 }}
                    >
                        Select on Page
                    </Button>

                    {showHint && (
                        <Box sx={{
                            mt: 3, p: 2, borderRadius: 2,
                            bgcolor: 'rgba(37, 99, 235, 0.06)',
                            border: '1px dashed rgba(37, 99, 235, 0.25)',
                            animation: 'fadeIn 0.6s ease-out',
                            '@keyframes fadeIn': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } }
                        }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
                                Click any repeating item on the page — a product card, search result, or table row. We'll find the rest automatically.
                            </Typography>
                        </Box>
                    )}
                </Paper>
            )}

            {/* Active Selection State */}
            {selectionStatus === 'selecting' && selectingFor === 'list' && (
                <Paper
                    variant="outlined"
                    sx={{
                        p: 4,
                        borderStyle: 'dashed',
                        borderWidth: 2,
                        borderColor: 'primary.main',
                        bgcolor: 'rgba(37, 99, 235, 0.05)',
                        textAlign: 'center',
                        borderRadius: 3,
                        // Simple pulse effect without keyframes for now, or could define keyframes in theme
                    }}
                >
                    <Box sx={{
                        color: 'primary.main',
                        display: 'flex',
                        justifyContent: 'center',
                        mb: 2,
                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: .5 },
                        }
                    }}>
                        <MousePointer2 size={40} />
                    </Box>
                    <Typography variant="subtitle1" color="primary.main" fontWeight="600" gutterBottom>
                        Listening for Click...
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Click any repeating item on the page (e.g. a product card, a row, a post).
                    </Typography>
                    <Button
                        variant="text"
                        color="inherit"
                        onClick={onCancel}
                        sx={{ mt: 2, textDecoration: 'underline' }}
                    >
                        Press ESC to cancel
                    </Button>
                </Paper>
            )}

            {/* Selected Items List */}
            {hasSelection && (
                <Stack spacing={2}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle2" color="text.secondary" fontWeight="600">
                            {selectors.length} {selectors.length === 1 ? 'Field' : 'Fields'} Selected
                        </Typography>
                        <Button
                            startIcon={<Plus size={16} />}
                            size="small"
                            onClick={onStartSelection}
                            disabled={selectionStatus === 'selecting'}
                        >
                            Add Another Field
                        </Button>
                    </Box>

                    <Stack spacing={2}>
                        {selectors.map((selector) => (
                            <SelectorCard
                                key={selector.id}
                                selector={selector}
                                onRemove={() => onRemoveSelector(selector.id)}
                                onUpdate={onUpdateSelector}
                                onTest={onTestSelector}
                            />
                        ))}
                    </Stack>

                    <Box sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            variant="contained"
                            size="large"
                            onClick={onNext}
                            disabled={selectionStatus === 'selecting'}
                            sx={{ borderRadius: 2, px: 4 }}
                        >
                            Configure Pagination
                        </Button>
                    </Box>
                </Stack>
            )}
        </Box>
    );
}
