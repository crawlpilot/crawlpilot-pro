import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormHelperText, Stack, Switch, TextField, Typography } from '@mui/material';
import { Play } from 'lucide-react';
import { isBulkJob, type JobWithRecipe } from './jobFilters';
import { defaultConcurrency } from '@/shared/utils/concurrency';

export interface RerunOptions {
    name: string;
    maxPages: number;
    parallel: boolean;
    concurrent: number;
}

/** Name, page limit and concurrency for re-running a job (open while `job` is set). */
export function RerunDialog({ job, onClose, onStart }: { job: JobWithRecipe | null; onClose: () => void; onStart: (job: JobWithRecipe, options: RerunOptions) => void }) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const [rerunName, setRerunName] = useState('');
    const [rerunMaxPages, setRerunMaxPages] = useState(10);
    const [rerunParallel, setRerunParallel] = useState(false);
    const [rerunConcurrent, setRerunConcurrent] = useState(defaultConcurrency);

    useEffect(() => {
        if (!job) return;
        setRerunName(job.name ? `${job.name} (${t('rerun')})` : `${t('rerun')}: ${job.recipe?.name || tc('na')}`);
        setRerunMaxPages(job.input?.maxPages || 10);
        setRerunParallel((job.input?.concurrency ?? 1) > 1);
        setRerunConcurrent(job.input?.concurrency || 3);
    }, [job, t, tc]);

    return (
        <Dialog
            open={!!job}
            onClose={onClose}
            fullWidth
            maxWidth="xs"
            PaperProps={{
                sx: { borderRadius: 3, bgcolor: 'background.paper', backgroundImage: 'none' }
            }}
        >
            <DialogTitle sx={{ pb: 1 }}>{t('configureRerun')}</DialogTitle>
            <DialogContent>
                <Stack spacing={3} sx={{ mt: 1 }}>
                    <TextField
                        label={t('runName')}
                        fullWidth
                        size="small"
                        value={rerunName}
                        onChange={(e) => setRerunName(e.target.value)}
                        placeholder={t('runNamePlaceholder')}
                    />
                    {job?.recipe?.spec.kind === 'list' && job.recipe.spec.pagination.mode === 'pagination' && (
                        <Box>
                            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                                {t('maxPages')}
                            </Typography>
                            <TextField
                                type="number"
                                fullWidth
                                size="small"
                                value={rerunMaxPages}
                                onChange={(e) => setRerunMaxPages(parseInt(e.target.value) || 1)}
                                InputProps={{ inputProps: { min: 1 } }}
                                helperText={t('maxPagesHelper')}
                            />
                        </Box>
                    )}

                    {job && isBulkJob(job) && (
                        <>
                            <Box>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={rerunParallel}
                                            onChange={(e) => setRerunParallel(e.target.checked)}
                                            color="secondary"
                                        />
                                    }
                                    label={<Typography variant="body2">{t('parallelMode')}</Typography>}
                                />
                                <FormHelperText>{t('parallelModeHelper')}</FormHelperText>
                            </Box>

                            {rerunParallel && (
                                <Box>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                                        {t('concurrencyLimit')}
                                    </Typography>
                                    <TextField
                                        type="number"
                                        fullWidth
                                        size="small"
                                        value={rerunConcurrent}
                                        onChange={(e) => setRerunConcurrent(parseInt(e.target.value) || 1)}
                                        InputProps={{ inputProps: { min: 1, max: 10 } }}
                                        helperText={t('concurrencyHelper')}
                                    />
                                </Box>
                            )}
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, pt: 0 }}>
                <Button onClick={onClose} color="inherit">{tc('cancel')}</Button>
                <Button
                    variant="contained"
                    color="secondary"
                    onClick={() => job && onStart(job, { name: rerunName, maxPages: rerunMaxPages, parallel: rerunParallel, concurrent: rerunConcurrent })}
                    startIcon={<Play size={16} />}
                >
                    {t('startNow')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
