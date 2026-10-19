import { ReactNode, useEffect, useState } from 'react';
import { MousePointer2, Plus } from 'lucide-react';
import { Box, Button, Typography, Paper, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SelectorCard } from '../SelectorCard';
import { ListPick } from '../../../../shared/types/extraction';

const HINT_KEY = 'crawlpilot_list_hint_seen';

interface Step1SelectionProps {
    selectors: ListPick[];
    selectionStatus?: 'idle' | 'selecting' | 'ready';
    selectingFor: string | null;
    onStartSelection: () => void;
    onRemoveSelector: (id: string) => void;
    onUpdateSelector: (id: string, updates: Partial<ListPick>) => void;
    onTestSelector: (selector: string) => void;
    onNext: () => void;
    onCancel?: () => void;
    /** The one-click run card, shown once a list is picked. */
    quickRun?: ReactNode;
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
    onCancel,
    quickRun
}: Step1SelectionProps) {

    const { t } = useTranslation('listExtractor');
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
                        {t('step1.pickRepeatingItem')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph sx={{ maxWidth: 280, mx: 'auto', mb: 3 }}>
                        {t('step1.pickDescription')}
                    </Typography>

                    <Button
                        variant="contained"
                        size="large"
                        onClick={onStartSelection}
                        startIcon={<MousePointer2 size={18} />}
                        sx={{ borderRadius: 2, px: 4, py: 1.5 }}
                    >
                        {t('step1.selectOnPage')}
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
                                {t('step1.hint')}
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
                        {t('step1.listeningForClick')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('step1.clickAnyRepeating')}
                    </Typography>
                    <Button
                        variant="text"
                        color="inherit"
                        onClick={onCancel}
                        sx={{ mt: 2, textDecoration: 'underline' }}
                    >
                        {t('step1.pressEscToCancel')}
                    </Button>
                </Paper>
            )}

            {/* Selected Items List */}
            {hasSelection && (
                <Stack spacing={2}>
                    {quickRun}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle2" color="text.secondary" fontWeight="600">
                            {t('step1.fieldsSelected', { count: selectors.length })}
                        </Typography>
                        <Button
                            startIcon={<Plus size={16} />}
                            size="small"
                            onClick={onStartSelection}
                            disabled={selectionStatus === 'selecting'}
                        >
                            {t('step1.addAnotherField')}
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
                            variant={quickRun ? 'text' : 'contained'}
                            onClick={onNext}
                            disabled={selectionStatus === 'selecting'}
                            sx={{ borderRadius: 2, px: quickRun ? 1.5 : 4 }}
                        >
                            {t('step1.configurePagination')}
                        </Button>
                    </Box>
                </Stack>
            )}
        </Box>
    );
}
