import { MousePointer2 } from 'lucide-react';
import { Box, Button, Typography, Paper, Stack } from '@mui/material';
import { SelectorState } from '../../../../shared/types/extraction';
import { SelectorCard } from '../../list-extractor/SelectorCard';

interface Step1SelectionProps {
    selectors: SelectorState[];
    selectionStatus?: 'idle' | 'selecting' | 'ready';
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
    onStartSelection,
    onRemoveSelector,
    onUpdateSelector,
    onTestSelector,
    onNext,
    onCancel
}: Step1SelectionProps) {
    const hasSelection = selectors.length > 0;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                        Select Text Content
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph sx={{ maxWidth: 280, mx: 'auto', mb: 3 }}>
                        Click on the article, paragraph, or container you want to summarize.
                    </Typography>

                    <Button
                        variant="contained"
                        size="large"
                        onClick={onStartSelection}
                        startIcon={<MousePointer2 size={18} />}
                        sx={{ borderRadius: 2, px: 4, py: 1.5 }}
                    >
                        Start Selecting
                    </Button>
                </Paper>
            )}

            {selectionStatus === 'selecting' && (
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
                        Selection Mode Active
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Click on the text content in the page to select it.
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

            {hasSelection && (
                <Stack spacing={2}>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="600">
                        Selected Element
                    </Typography>

                    <SelectorCard
                        selector={selectors[0]}
                        onRemove={() => onRemoveSelector(selectors[0].id)}
                        onUpdate={(id, updates) => onUpdateSelector(id, updates)}
                        onTest={onTestSelector}
                    />

                    <Box sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={onStartSelection}
                            disabled={selectionStatus === 'selecting'}
                        >
                            Reselect
                        </Button>
                        <Button
                            variant="contained"
                            size="large"
                            onClick={onNext}
                            disabled={selectionStatus === 'selecting'}
                            sx={{ borderRadius: 2, px: 4 }}
                        >
                            Confirm & Summarize
                        </Button>
                    </Box>
                </Stack>
            )}
        </Box>
    );
}
