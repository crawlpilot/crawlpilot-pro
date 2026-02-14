import { SelectorState, PaginationMode } from '../../../../shared/types/extraction';
import { Settings2, Play, ChevronDown, Gauge, RotateCcw } from 'lucide-react';
import { ExtractionStatusBar } from '../ExtractionStatusBar';
import { Box, Typography, Button, Paper, Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText, Divider, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Stack, TextField } from '@mui/material';
import { PaginationSpeed, PAGINATION_PROFILES } from '../../../../shared/constants/paginationConfig';

interface Step3ReviewProps {
    paginationMode: PaginationMode;
    selectors: SelectorState[];
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

    const handleSpeedChange = (event: SelectChangeEvent<PaginationSpeed>) => {
        onSpeedChange(event.target.value as PaginationSpeed);
    };

    const currentProfile = PAGINATION_PROFILES[speed];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, animation: 'fadeIn 0.3s ease-out' }}>
            {!isExtracting && (
                <Box>
                    <Typography variant="h6" gutterBottom>Ready to Extract</Typography>
                    <Typography variant="body2" color="text.secondary">Review your setup and start the extraction.</Typography>
                </Box>
            )}

            {/* Config Summary */}
            <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                <Box sx={{ bgcolor: 'background.paper', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle2" textTransform="uppercase" letterSpacing={1} color="text.secondary">
                        Summary
                    </Typography>
                </Box>
                <List dense disablePadding>
                    <ListItem>
                        <ListItemText
                            primary="Data Points"
                            secondary={`${selectors.length} fields selected (${selectors[0]?.count || 0} items preview)`}
                            primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                            secondaryTypographyProps={{ variant: 'body1', color: 'text.primary', fontWeight: 500 }}
                        />
                    </ListItem>
                    <Divider component="li" />
                    <ListItem>
                        <ListItemText
                            primary="Page Limit"
                            secondary={paginationMode === 'pagination' ? `${maxPages} pages` : 'Single Page'}
                            primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                            secondaryTypographyProps={{ variant: 'body1', color: 'text.primary', fontWeight: 500 }}
                        />
                    </ListItem>
                </List>
            </Paper>

            {/* Speed Configuration */}
            {
                !isExtracting && (
                    <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                        <Box sx={{ bgcolor: 'background.paper', p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="subtitle2" textTransform="uppercase" letterSpacing={1} color="text.secondary">
                                Execution Speed
                            </Typography>
                            <Gauge size={16} className="text-gray-400" />
                        </Box>
                        <Box sx={{ p: 2 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel id="speed-select-label">Speed Profile</InputLabel>
                                <Select
                                    labelId="speed-select-label"
                                    value={speed}
                                    label="Speed Profile"
                                    onChange={handleSpeedChange}
                                >
                                    <MenuItem value="slow">Slow (Safe, reliable for heavy sites)</MenuItem>
                                    <MenuItem value="normal">Normal (Balanced)</MenuItem>
                                    <MenuItem value="fast">Fast (Aggressive, for simple sites)</MenuItem>
                                </Select>
                            </FormControl>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                Wait time between actions: {currentProfile.navigationDelay}ms
                            </Typography>
                        </Box>
                    </Paper>
                )
            }

            {/* Advanced Settings (Accordion) */}
            {
                !isExtracting && (
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
                                <Typography variant="body2" fontWeight="500">Advanced Settings</Typography>
                            </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Stack spacing={2} sx={{ pt: 1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Box>
                                        <Typography variant="body2" fontWeight="500">Wait Delay</Typography>
                                        <Typography variant="caption" color="text.secondary">Based on speed profile</Typography>
                                    </Box>
                                    <Typography variant="body2" fontFamily="monospace">{currentProfile.navigationDelay}ms</Typography>
                                </Box>

                                {paginationMode === 'pagination' && (
                                    <>
                                        <Divider />
                                        <Box>
                                            <Typography variant="body2" fontWeight="500" sx={{ mb: 1 }}>Max Pages to Extract</Typography>
                                            <TextField
                                                type="number"
                                                size="small"
                                                fullWidth
                                                value={maxPages}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onMaxPagesChange(Math.max(1, parseInt(e.target.value) || 1))}
                                                InputProps={{ inputProps: { min: 1 } }}
                                                helperText="Extraction halts after reaching this limit"
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
                            <Typography variant="subtitle2" fontWeight="bold">Extraction Failed</Typography>
                            <Typography variant="body2">{status.error || "An unknown error occurred."}</Typography>
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
                            Back
                        </Button>
                        <Button
                            variant="contained"
                            onClick={onStart}
                            startIcon={<Play size={16} />}
                            color="success"
                            size="large"
                        >
                            Start Extraction
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
                            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html?view=data-table') })}
                        >
                            View Extracted Data
                        </Button>
                        <Button
                            variant="outlined"
                            fullWidth
                            color="inherit"
                            onClick={onReset}
                            startIcon={<RotateCcw size={16} />}
                        >
                            Start New Extraction
                        </Button>
                    </Box>
                )
            }
        </Box >
    );
}
