/** Step 2 of "Same details from many pages": a ready-made set of details, or the user's own fields. */
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { ChevronRight, FileText, MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function Choice({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
    return (
        <ButtonBase onClick={onClick} sx={{
            display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', p: 1.75, borderRadius: '12px', textAlign: 'left',
            border: 1, borderColor: 'divider', bgcolor: 'background.paper', '&:hover': { borderColor: 'primary.main', bgcolor: 'rgb(var(--cp-accent-rgb) / 0.04)' },
        }}>
            <Box sx={{ color: 'primary.light', display: 'flex' }}>{icon}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.primary' }}>{title}</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.74rem' }}>{hint}</Typography>
            </Box>
            <ChevronRight size={16} color="var(--cp-text-3)" />
        </ButtonBase>
    );
}

export function DetailsChoice({ pages, onArticle, onFields }: { pages: number; onArticle: () => void; onFields: () => void }) {
    const { t } = useTranslation('pageExtractor');
    return (
        <Stack spacing={1.25}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: 'text.primary' }}>{t('details.title')}</Typography>
            <Typography variant="body2" sx={{ mt: -0.5 }}>{t('details.subtitle', { count: pages })}</Typography>
            <Choice icon={<FileText size={20} />} title={t('details.article.title')} hint={t('details.article.hint')} onClick={onArticle} />
            <Choice icon={<MousePointerClick size={20} />} title={t('details.fields.title')} hint={t('details.fields.hint')} onClick={onFields} />
        </Stack>
    );
}
