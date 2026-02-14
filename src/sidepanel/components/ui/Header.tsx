import { AppBar, Toolbar, Box, Typography, IconButton, Button, useTheme } from '@mui/material';
import { Settings, Dashboard, History, Storage } from '@mui/icons-material';

interface HeaderProps {
    onNavigate: (view: string) => void;
    activeView?: string;
    disabled?: boolean;
}

export default function Header({ onNavigate, activeView, disabled }: HeaderProps) {
    const theme = useTheme();

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
                py: 1.5,
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
                            width: 28,
                            height: 28,
                            filter: 'drop-shadow(0 0 8px rgba(37, 99, 235, 0.5))'
                        }}
                    />
                    <Typography
                        variant="subtitle1"
                        sx={{
                            fontWeight: 700,
                            letterSpacing: '-0.025em',
                            color: '#F8FAFC', // Slate 50
                            fontSize: '0.95rem'
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
                    <Settings sx={{ fontSize: 18 }} />
                </IconButton>
            </Toolbar>

            {/* Premium "Pill" Navigation Bar */}
            <Box sx={{ px: 2, pb: 2 }}>
                <Box sx={{
                    display: 'flex',
                    p: 0.5,
                    bgcolor: '#020617', // Slate 950
                    borderRadius: 999, // Full pill shape
                    border: `1px solid ${theme.palette.divider}`,
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <NavPill
                        icon={<Dashboard sx={{ fontSize: 16 }} />}
                        label="Home"
                        active={activeView === 'home' || (Boolean(activeView) && (activeView!.includes('-extractor') || activeView === 'image-downloader' || activeView === 'page-extractor'))}
                        onClick={() => onNavigate('home')}
                    />
                    <NavPill
                        icon={<History sx={{ fontSize: 16 }} />}
                        label="Jobs"
                        active={activeView === 'history'}
                        onClick={() => onNavigate('history')}
                    />
                    <NavPill
                        icon={<Storage sx={{ fontSize: 16 }} />}
                        label="History"
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

const NavPill = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean | string | null, onClick: () => void }) => {
    const isActive = Boolean(active);

    return (
        <Button
            onClick={onClick}
            fullWidth
            startIcon={icon}
            sx={{
                justifyContent: 'center',
                textTransform: 'none',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: isActive ? '#F8FAFC' : '#64748B', // Slate 50 vs Slate 500
                background: isActive ?
                    'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)' : // Slate 800 -> 900
                    'transparent',
                borderRadius: 999, // Pill shape
                py: 0.85,
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
};
