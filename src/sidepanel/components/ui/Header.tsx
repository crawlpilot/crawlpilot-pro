import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { Database, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
    onNavigate: (view: string) => void;
    activeView?: string;
    disabled?: boolean;
}

/**
 * The panel's header on Home: the brand, the user's saved data and settings, in one row. Tools
 * replace it with their own header (back, name, steps), so the panel never shows two navigations.
 */
export default function Header({ onNavigate, activeView, disabled }: HeaderProps) {
    const { t } = useTranslation('common');
    const go = (view: string) => { if (!disabled) onNavigate(view); };

    return (
        <Box component="header" sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.1, flexShrink: 0,
            borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
            opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.3s',
        }}>
            <Box onClick={() => go('home')} role="link" aria-label={t('nav.home')}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                <Box component="img" src={chrome.runtime.getURL('icons/icon32.png')} alt="" sx={{ width: 22, height: 22 }} />
                <Typography sx={{ fontWeight: 700, fontSize: '0.92rem', letterSpacing: '-0.02em', color: 'text.primary' }}>CrawlPilot</Typography>
            </Box>
            <Tooltip title={t('nav.myDataTooltip')}>
                <Button size="small" onClick={() => go('history')} startIcon={<Database size={15} />}
                    sx={{ color: activeView === 'history' ? 'primary.main' : 'text.secondary', fontWeight: 600, px: 1.25, '&:hover': { color: 'text.primary' } }}>
                    {t('nav.myData')}
                </Button>
            </Tooltip>
            <Tooltip title={t('nav.settings')}>
                <IconButton size="small" onClick={() => go('settings')} aria-label={t('nav.settings')} sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                    <Settings size={17} />
                </IconButton>
            </Tooltip>
        </Box>
    );
}
