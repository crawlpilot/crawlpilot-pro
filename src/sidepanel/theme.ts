import { createTheme, alpha } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#2563EB', // Indigo Blue
            light: '#60A5FA',
            dark: '#1D4ED8',
            contrastText: '#FFFFFF',
        },
        secondary: {
            main: '#22D3EE', // Cyan (AI Accent)
            contrastText: '#0F172A',
        },
        background: {
            default: '#0F172A', // Deep Slate
            paper: '#1E293B',   // Slightly lighter for cards/surfaces
        },
        text: {
            primary: '#E5E7EB',
            secondary: '#9CA3AF',
        },
        success: {
            main: '#22C55E',
        },
        warning: {
            main: '#F59E0B',
        },
        error: {
            main: '#EF4444',
        },
        divider: 'rgba(148, 163, 184, 0.12)', // Subtle border
    },
    typography: {
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        h1: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.015em' }, // Tight healing
        h2: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.015em' },
        body1: { fontSize: '0.8125rem', lineHeight: 1.5 }, // 13px
        body2: { fontSize: '0.75rem', lineHeight: 1.5, color: '#9CA3AF' }, // 12px
        button: { textTransform: 'none', fontWeight: 500, fontSize: '0.8125rem' },
    },
    shape: {
        borderRadius: 8,
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    scrollbarWidth: 'thin',
                    '&::-webkit-scrollbar': {
                        width: '8px',
                        height: '8px',
                    },
                    '&::-webkit-scrollbar-track': {
                        background: 'transparent',
                    },
                    '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#334155',
                        borderRadius: '4px',
                        border: '2px solid #0F172A',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                        backgroundColor: '#475569',
                    },
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 6, // Matching .btn
                    padding: '6px 12px',
                    boxShadow: 'none',
                    '&:hover': {
                        boxShadow: 'none',
                    },
                },
                containedPrimary: {
                    '&:hover': {
                        backgroundColor: '#1D4ED8',
                    },
                },
                outlined: {
                    borderColor: 'rgba(148, 163, 184, 0.2)',
                    color: '#E5E7EB',
                    '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        borderColor: 'rgba(148, 163, 184, 0.3)',
                    },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    backgroundColor: '#020617', // Panel background
                    border: '1px solid rgba(148, 163, 184, 0.12)',
                },
                rounded: {
                    borderRadius: 8,
                }
            },
        },
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: alpha('#020617', 0.8),
                    backdropFilter: 'blur(12px)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: 'none',
                }
            }
        },
        MuiIconButton: {
            styleOverrides: {
                root: {
                    color: '#9CA3AF',
                    '&:hover': {
                        color: '#FFFFFF',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    }
                }
            }
        }
    },
});

export default theme;
