import { AppBar, Toolbar, Box, Typography, IconButton, Button, useTheme, Tooltip } from '@mui/material';
import { Settings, LayoutDashboard, History, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
    onNavigate: (view: string) => void;
    activeView?: string;
    disabled?: boolean;
}

export default function Header({ onNavigate, activeView, disabled }: HeaderProps) {
    const theme = useTheme();
    const { t } = useTranslation('common');

    const handleSettingsClick = () => {
        if (disabled) return;
        onNavigate('settings');
    };

    return (
        <AppBar position="sticky" color="transparent" elevation={0} sx={{
            backgroundColor: 'rgba(15, 23, 42, 0.95)', // Slate 900 base
            backdropFilter: 'blur(20px)',
            borderBottom: `1px solid ${theme.palette.divider}`,
            zIndex: theme.zIndex.appBar,
            opacity: disabled ? 0.5 : 1,
            pointerEvents: disabled ? 'none' : 'auto',
            filter: disabled ? 'grayscale(0.5)' : 'none',
            transition: 'opacity 0.3s, filter 0.3s'
        }}>
            <Toolbar variant="dense" sx={{
                justifyContent: 'space-between',
                px: 2,
                py: 1,
                minHeight: 'unset'
            }}>
                {/* Brand Identity */}
                <Box
                    onClick={() => onNavigate('home')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        cursor: 'pointer',
                        transition: 'opacity 0.2s',
                        '&:hover': { opacity: 0.85 }
                    }}
                >
                    <Box
                        component="img"
                        src={chrome.runtime.getURL('icons/icon32.png')}
                        alt="Crawl Pilot"
                        sx={{
                            width: 26,
                            height: 26,
                            filter: 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.5))'
                        }}
                    />
                    <Typography
                        variant="subtitle1"
                        sx={{
                            fontWeight: 700,
                            letterSpacing: '-0.025em',
                            color: '#F8FAFC',
                            fontSize: '0.9rem'
                        }}
                    >
                        Crawl Pilot
                    </Typography>
                </Box>

                {/* Settings Action */}
                <IconButton
                    size="small"
                    onClick={handleSettingsClick}
                    sx={{
                        color: 'text.secondary',
                        transition: 'all 0.2s',
                        '&:hover': {
                            color: 'primary.light',
                            backgroundColor: 'rgba(255,255,255,0.05)',
                            transform: 'rotate(90deg)'
                        }
                    }}
                >
                    <Settings size={18} />
                </IconButton>
            </Toolbar>

            {/* Premium "Pill" Navigation Bar */}
            <Box sx={{ px: 2, pb: 1.5 }}>
                <Box sx={{
                    display: 'flex',
                    p: 0.4,
                    bgcolor: '#020617',
                    borderRadius: 999,
                    border: `1px solid ${theme.palette.divider}`,
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <NavPill
                        icon={<LayoutDashboard size={16} />}
                        label={t('nav.home')}
                        tooltip={t('nav.homeTooltip')}
                        active={activeView === 'home' || (Boolean(activeView) && (activeView!.includes('-extractor') || activeView === 'image-downloader' || activeView === 'page-extractor'))}
                        onClick={() => onNavigate('home')}
                    />
                    <NavPill
                        icon={<History size={16} />}
                        label={t('nav.runs')}
                        tooltip={t('nav.runsTooltip')}
                        active={activeView === 'history'}
                        onClick={() => onNavigate('history')}
                    />
                    <NavPill
                        icon={<Database size={16} />}
                        label={t('nav.data')}
                        tooltip={t('nav.dataTooltip')}
                        active={activeView === 'data-table'}
                        onClick={() => {
                            const url = chrome.runtime.getURL('sidepanel.html?view=data-table');
                            chrome.tabs.create({ url });
                        }}
                    />
                </Box>
            </Box>
        </AppBar>
    );
}

const NavPill = ({ icon, label, tooltip, active, onClick }: { icon: React.ReactNode, label: string, tooltip?: string, active?: boolean | string | null, onClick: () => void }) => {
    const isActive = Boolean(active);

    const button = (
        <Button
            onClick={onClick}
            fullWidth
            startIcon={icon}
            sx={{
                justifyContent: 'center',
                textTransform: 'none',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: isActive ? '#F8FAFC' : '#64748B',
                background: isActive ?
                    'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)' :
                    'transparent',
                borderRadius: 999,
                py: 0.7,
                border: isActive ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                boxShadow: isActive ? '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.15)' : 'none',
                position: 'relative',
                zIndex: 1,
                overflow: 'hidden',
                '&:hover': {
                    color: isActive ? '#F8FAFC' : '#94A3B8',
                    backgroundColor: isActive ? 'transparent' : 'rgba(255, 255, 255, 0.03)',
                },
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',

                // Glow effect for active state
                '&::before': isActive ? {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 999,
                    padding: '1px',
                    background: 'linear-gradient(to right, rgba(59, 130, 246, 0.5), rgba(34, 211, 238, 0.5))',
                    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    maskComposite: 'exclude',
                    pointerEvents: 'none',
                    opacity: 0.6
                } : {}
            }}
        >
            {label}
        </Button>
    );

    return tooltip ? <Tooltip title={tooltip} placement="bottom" arrow>{button}</Tooltip> : button;
};
