import { ListPick, PaginationMode } from '../../../../shared/types/extraction';
import { Settings2, Play, ChevronDown, Gauge, RotateCcw, CheckCircle2 } from 'lucide-react';
import { ExtractionStatusBar } from '../ExtractionStatusBar';
import { Box, Typography, Button, Paper, Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText, Divider, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Stack, TextField } from '@mui/material';
import { PaginationSpeed, PAGINATION_PROFILES } from '../../../../shared/constants/paginationConfig';
import { useTranslation } from 'react-i18next';

interface Step3ReviewProps {
    paginationMode: PaginationMode;
    selectors: ListPick[];
    onStart: () => void;
    onBack: () => void;
    isExtracting: boolean;
    status: any;
    onStop: (force?: boolean) => void;
    onReset: () => void; // [NEW] Reset callback
    speed: PaginationSpeed;
    onSpeedChange: (speed: PaginationSpeed) => void;
    maxPages: number;
    onMaxPagesChange: (pages: number) => void;
}

export function Step3Review({
    paginationMode,
    selectors,
    onStart,
    onBack,
    isExtracting,
    status,
    onStop,
    onReset,
    speed,
    onSpeedChange,
    maxPages,
    onMaxPagesChange
}: Step3ReviewProps) {

    const { t } = useTranslation('listExtractor');
    const handleSpeedChange = (event: SelectChangeEvent<PaginationSpeed>) => {
        onSpeedChange(event.target.value as PaginationSpeed);
    };

    const currentProfile = PAGINATION_PROFILES[speed];
    const ended = !isExtracting && (status?.status === 'completed' || status?.status === 'stopped');
    const fieldCount = selectors[0]?.data?.columns?.length ?? selectors.length;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, animation: 'fadeIn 0.3s ease-out' }}>
            {ended && (
                <Box sx={{ border: 1, borderColor: 'rgba(16,185,129,0.4)', bgcolor: 'rgba(16,185,129,0.06)', borderRadius: '14px', p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CheckCircle2 size={20} style={{ color: 'var(--cp-success)' }} />
                        <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: 'text.primary' }}>
                            {status.status === 'stopped' ? t('step3.stoppedTitle', { count: status.itemsSaved ?? 0 }) : t('step3.doneTitle', { count: status.itemsSaved ?? 0 })}
                            {status.pagesVisited ? ` ${t('step3.donePages', { count: status.pagesVisited })}` : ''}
                        </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>{t('step3.doneHint')}</Typography>
                </Box>
            )}

            {!isExtracting && !ended && (
                <Box>
                    <Typography variant="h6" gutterBottom>{t('step3.reviewAndRun')}</Typography>
                    <Typography variant="body2" color="text.secondary">{t('step3.checkConfig')}</Typography>
                </Box>
            )}

            {/* Config Summary */}
            {!ended && <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                <Box sx={{ bgcolor: 'background.paper', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle2" color="text.secondary">
                        {t('step3.summary')}
                    </Typography>
                </Box>
                <List dense disablePadding>
                    <ListItem>
                        <ListItemText
                            primary={t('step3.fieldsSelected')}
                            secondary={t('step3.fieldsDetail', { count: fieldCount, items: selectors[0]?.count || 0 })}
                            primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                            secondaryTypographyProps={{ variant: 'body1', color: 'text.primary', fontWeight: 500 }}
                        />
                    </ListItem>
                    <Divider component="li" />
                    <ListItem>
                        <ListItemText
                            primary={t('step3.pageLimit')}
                            secondary={paginationMode === 'pagination' ? t('step3.pages', { count: maxPages }) : t('step3.singlePage')}
                            primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                            secondaryTypographyProps={{ variant: 'body1', color: 'text.primary', fontWeight: 500 }}
                        />
                    </ListItem>
                </List>
            </Paper>}

            {/* Speed Configuration */}
            {
                !isExtracting && !ended && (
                    <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                        <Box sx={{ bgcolor: 'background.paper', p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                {t('step3.crawlSpeed')}
                            </Typography>
                            <Gauge size={16} className="text-text-secondary" />
                        </Box>
                        <Box sx={{ p: 2 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel id="speed-select-label">{t('step3.speed')}</InputLabel>
                                <Select
                                    labelId="speed-select-label"
                                    value={speed}
                                    label={t('step3.speed')}
                                    onChange={handleSpeedChange}
                                >
                                    <MenuItem value="slow">{t('step3.careful')}</MenuItem>
                                    <MenuItem value="normal">{t('step3.balanced')}</MenuItem>
                                    <MenuItem value="fast">{t('step3.aggressive')}</MenuItem>
                                </Select>
                            </FormControl>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                {t('step3.waitTime', { ms: currentProfile.navigationDelay })}
                            </Typography>
                        </Box>
                    </Paper>
                )
            }

            {/* Advanced Settings (Accordion) */}
            {
                !isExtracting && !ended && (
                    <Accordion elevation={0} sx={{
                        bgcolor: 'transparent',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: '12px !important',
                        '&:before': { display: 'none' }
                    }}>
                        <AccordionSummary expandIcon={<ChevronDown size={16} />}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Settings2 size={16} />
                                <Typography variant="body2" fontWeight="500">{t('step3.advancedSettings')}</Typography>
                            </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Stack spacing={2} sx={{ pt: 1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Box>
                                        <Typography variant="body2" fontWeight="500">{t('step3.waitDelay')}</Typography>
                                        <Typography variant="caption" color="text.secondary">{t('step3.basedOnSpeed')}</Typography>
                                    </Box>
                                    <Typography variant="body2" fontFamily="monospace">{currentProfile.navigationDelay}ms</Typography>
                                </Box>

                                {paginationMode === 'pagination' && (
                                    <>
                                        <Divider />
                                        <Box>
                                            <Typography variant="body2" fontWeight="500" sx={{ mb: 1 }}>{t('step3.maxPagesToExtract')}</Typography>
                                            <TextField
                                                type="number"
                                                size="small"
                                                fullWidth
                                                value={maxPages}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onMaxPagesChange(Math.max(1, parseInt(e.target.value) || 1))}
                                                InputProps={{ inputProps: { min: 1 } }}
                                                helperText={t('step3.maxPagesHelper')}
                                            />
                                        </Box>
                                    </>
                                )}
                            </Stack>
                        </AccordionDetails>
                    </Accordion>
                )
            }

            {/* Status Bar (if extracting) */}
            {
                isExtracting && (
                    <Box sx={{ animation: 'slideUp 0.3s ease-out' }}>
                        <ExtractionStatusBar
                            status={status}
                            onStop={onStop}
                            onStart={onStart}
                            hasSelectors={selectors.length > 0}
                            selectorCount={selectors.length}
                            showStartButton={false}
                        />
                    </Box>
                )
            }

            {/* Error Message */}
            {
                !isExtracting && status?.status === 'failed' && (
                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            bgcolor: 'error.lighter',
                            color: 'error.dark',
                            border: '1px solid',
                            borderColor: 'error.light',
                            borderRadius: 2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2
                        }}
                    >
                        <Box>
                            <Typography variant="subtitle2" fontWeight="bold">{t('step3.extractionFailed')}</Typography>
                            <Typography variant="body2">{status.error || t('step3.unknownError')}</Typography>
                        </Box>
                    </Paper>
                )
            }

            {/* Actions */}
            {
                !isExtracting && (status?.status === 'idle' || !status?.status) && (
                    <Box sx={{ mt: 'auto', pt: 3, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button
                            onClick={onBack}
                            color="inherit"
                        >
                            {t('step3.back')}
                        </Button>
                        <Button
                            variant="contained"
                            onClick={onStart}
                            startIcon={<Play size={16} />}
                            color="success"
                            size="large"
                        >
                            {t('step3.startExtraction')}
                        </Button>
                    </Box>
                )
            }

            {/* Post-Extraction Actions (Finished/Stopped) */}
            {
                !isExtracting && (status?.status === 'completed' || status?.status === 'stopped' || status?.status === 'failed') && (
                    <Box sx={{ mt: 'auto', pt: 3, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Button
                            variant="contained"
                            fullWidth
                            color="primary"
                            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table${status?.tableId ? `&tableId=${status.tableId}` : ''}`) })}
                        >
                            {t('step3.openResultsTable')}
                        </Button>
                        <Button
                            variant="outlined"
                            fullWidth
                            color="inherit"
                            onClick={onReset}
                            startIcon={<RotateCcw size={16} />}
                        >
                            {t('step3.newExtraction')}
                        </Button>
                    </Box>
                )
            }
        </Box >
    );
}
