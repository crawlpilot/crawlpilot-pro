import { MousePointer2, ArrowRight } from 'lucide-react';
import { Box, Button, Typography, Card, CardActionArea, Stack } from '@mui/material';
import { PaginationMode, SelectorMetadata } from '../../../../shared/types/extraction';
import { NextButtonCard } from '../NextButtonCard';
import { SelectorEditDialog } from '../../shared/SelectorEditDialog';
import { useState } from 'react';

interface Step2NavigationProps {
    paginationMode: PaginationMode;
    setPaginationMode: (mode: PaginationMode) => void;
    nextButtonSelector: string | null;
    nextButtonSelectors: SelectorMetadata[];
    selectingFor: string | null;
    onStartSelection: (type: 'nextButton') => void;
    onRemoveNextButton: () => void;
    onUpdateNextButton: (selector: string | null, metadata?: SelectorMetadata[]) => void;
    onTestSelector: (selector: string) => void;
    onNext: () => void;
    onBack: () => void;
    onCancel?: () => void;
}

export function Step2Navigation({
    paginationMode,
    setPaginationMode,
    nextButtonSelector,
    nextButtonSelectors,
    selectingFor,
    onStartSelection,
    onRemoveNextButton,
    onUpdateNextButton,
    onTestSelector,
    onNext,
    onBack,
    onCancel
}: Step2NavigationProps) {

    const [isEditing, setIsEditing] = useState(false);

    // Helper to check if we are good to go
    const isReady = paginationMode === 'auto' || (nextButtonSelector !== null);

    const handleSaveSelectors = (newSelectors: SelectorMetadata[]) => {
        const primary = newSelectors.length > 0 ? newSelectors[0].selector : null;
        onUpdateNextButton(primary, newSelectors);
        setIsEditing(false);
    };

    const StrategyOption = ({
        mode,
        title,
        description
    }: { mode: PaginationMode; title: string; description: string }) => (
        <Card
            elevation={0}
            sx={{
                borderRadius: 3,
                border: '1px solid',
                borderColor: paginationMode === mode ? 'primary.main' : 'divider',
                bgcolor: paginationMode === mode ? 'rgba(37, 99, 235, 0.05)' : 'background.paper',
                transition: 'all 0.2s',
                position: 'relative',
                overflow: 'visible'
            }}
        >
            {paginationMode === mode && (
                <Box sx={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    boxShadow: '0 0 0 4px rgba(37, 99, 235, 0.2)'
                }} />
            )}
            <CardActionArea onClick={() => setPaginationMode(mode)} sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight="600" color={paginationMode === mode ? 'primary.main' : 'text.primary'}>
                    {title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, display: 'block', mt: 0.5 }}>
                    {description}
                </Typography>
            </CardActionArea>
        </Card>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, animation: 'fadeIn 0.3s ease-out' }}>
            <Box>
                <Typography variant="h6" gutterBottom>How do we get to the next page?</Typography>
                <Typography variant="body2" color="text.secondary">Choose the method that matches this website.</Typography>
            </Box>

            {/* Strategy Options */}
            <Stack spacing={2}>
                <StrategyOption
                    mode="pagination"
                    title='Click "Next" Button'
                    description="Standard number navigation (1, 2, 3, Next >)"
                />
                <StrategyOption
                    mode="loadMore"
                    title='Click "Load More"'
                    description="A button that adds items to the bottom"
                />
                <StrategyOption
                    mode="auto"
                    title="No Button / Scroll"
                    description="Infinite scroll or just extract this single page"
                />
            </Stack>

            {/* Selection Area (only for button modes) */}
            {(paginationMode === 'pagination' || paginationMode === 'loadMore') && (
                <Box sx={{ mt: 1, pt: 3, borderTop: '1px solid', borderColor: 'divider', animation: 'slideUp 0.3s ease-out' }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                        Select the {paginationMode === 'loadMore' ? 'Load More' : 'Next'} Button
                    </Typography>

                    {selectingFor === 'nextButton' ? (
                        <Card
                            variant="outlined"
                            sx={{
                                p: 3,
                                borderStyle: 'dashed',
                                borderWidth: 2,
                                borderColor: 'primary.main',
                                bgcolor: 'rgba(37, 99, 235, 0.05)',
                                textAlign: 'center',
                                animation: 'pulse 2s infinite'
                            }}
                        >
                            <MousePointer2 size={24} className="text-blue-500 mb-2 mx-auto" style={{ display: 'block' }} />
                            <Typography variant="body2" color="primary.main" fontWeight="500">
                                Click the button on the page...
                            </Typography>
                            <Button
                                variant="text"
                                color="inherit"
                                onClick={onCancel}
                                sx={{ mt: 1, textDecoration: 'underline', fontSize: '0.75rem' }}
                            >
                                Press ESC to cancel
                            </Button>
                        </Card>
                    ) : nextButtonSelector ? (
                        <NextButtonCard
                            selector={nextButtonSelector}
                            metadata={nextButtonSelectors}
                            title={paginationMode === 'loadMore' ? 'Load More Button' : 'Next Button'}
                            onRemove={onRemoveNextButton}
                            onTest={onTestSelector}
                            onEdit={() => setIsEditing(true)}
                        />
                    ) : (
                        <Button
                            variant="outlined"
                            fullWidth
                            startIcon={<MousePointer2 size={16} />}
                            onClick={() => onStartSelection('nextButton')}
                            sx={{ borderStyle: 'dashed', py: 2 }}
                        >
                            Click to Select Button
                        </Button>
                    )}
                </Box>
            )}

            {/* Next Action */}
            <Box sx={{ mt: 'auto', pt: 3, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Button
                    onClick={onBack}
                    color="inherit"
                >
                    Back
                </Button>
                <Button
                    variant="contained"
                    onClick={onNext}
                    disabled={!isReady}
                    endIcon={<ArrowRight size={16} />}
                >
                    Next Step
                </Button>
            </Box>

            {/* Selector Editor Modal */}
            <SelectorEditDialog
                isOpen={isEditing}
                title="Edit Navigation Selectors"
                selectors={nextButtonSelectors && nextButtonSelectors.length > 0
                    ? nextButtonSelectors
                    : (nextButtonSelector ? [{ selector: nextButtonSelector, strategy: 'Manual/Direct' }] : [])
                }
                onSave={handleSaveSelectors}
                onCancel={() => setIsEditing(false)}
                // We pass a simplified verify for now or wrap existing one
                onVerify={async (s) => onTestSelector(s)}
            />
        </Box>
    );
}
