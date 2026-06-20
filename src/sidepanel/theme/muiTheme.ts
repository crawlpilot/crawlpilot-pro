import { createTheme } from '@mui/material/styles';

export const muiTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#06B6D4', // Cyan — unified with extraction highlights & stepper
            light: '#22D3EE',
            dark: '#0891B2',
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#8B5CF6', // Violet accent
            light: '#A78BFA',
            dark: '#7C3AED',
            contrastText: '#ffffff',
        },
        background: {
            default: '#030712', // Deep Space Black (gray-950)
            paper: '#0B0F19',   // Dark surface
        },
        text: {
            primary: '#F8FAFC',
            secondary: '#94A3B8', // Slate 400
        },
        error: { main: '#F43F5E' },
        success: { main: '#10B981' },
        warning: { main: '#F59E0B' },
        divider: 'rgba(255, 255, 255, 0.08)',
    },
    typography: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        h1: { fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.2 },
        h2: { fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.3 },
        h3: { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' },
        h5: { fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.01em' },
        h6: { fontSize: '0.85rem', fontWeight: 600, letterSpacing: '-0.01em' },
        subtitle1: { fontSize: '0.78rem', fontWeight: 500, color: '#94A3B8' },
        subtitle2: { fontSize: '0.72rem', fontWeight: 600, color: '#F8FAFC' },
        body1: { fontSize: '0.8125rem', lineHeight: 1.6 },
        body2: { fontSize: '0.78rem', lineHeight: 1.5, color: '#94A3B8' },
        caption: { fontSize: '0.68rem', lineHeight: 1.4, color: '#64748B' },
        button: { textTransform: 'none', fontWeight: 600, fontSize: '0.78rem', letterSpacing: '0.01em' },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    scrollbarWidth: 'thin',
                    '&::-webkit-scrollbar': { width: '6px', height: '6px' },
                    '&::-webkit-scrollbar-track': { background: 'transparent' },
                    '&::-webkit-scrollbar-thumb': {
                        backgroundColor: 'rgba(148, 163, 184, 0.2)',
                        borderRadius: '3px',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                        backgroundColor: 'rgba(148, 163, 184, 0.35)',
                    },
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: '8px',
                    padding: '6px 14px',
                    boxShadow: 'none',
                    transition: 'all 0.15s ease',
                    '&:hover': {
                        boxShadow: 'none',
                        transform: 'translateY(-1px)',
                    },
                    '&:active': {
                        transform: 'translateY(0px)',
                    }
                },
                containedPrimary: {
                    background: 'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)',
                    '&:hover': {
                        background: 'linear-gradient(135deg, #22D3EE 0%, #06B6D4 100%)',
                    },
                },
                outlined: {
                    borderColor: 'rgba(255,255,255,0.12)',
                    '&:hover': {
                        borderColor: 'rgba(6, 182, 212, 0.5)',
                        backgroundColor: 'rgba(6, 182, 212, 0.05)',
                    }
                }
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
                },
                rounded: {
                    borderRadius: '12px',
                }
            },
        },
        MuiTooltip: {
            styleOverrides: {
                tooltip: {
                    backgroundColor: '#1E293B',
                    color: '#F8FAFC',
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '6px 10px',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                },
                arrow: {
                    color: '#1E293B',
                }
            },
        },
        MuiAlert: {
            styleOverrides: {
                root: {
                    borderRadius: '10px',
                    fontSize: '0.75rem',
                },
            },
        },
        MuiStepper: {
            styleOverrides: {
                root: { background: 'transparent', padding: 0 },
            },
        },
        MuiStepLabel: {
            styleOverrides: {
                label: {
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    '&.Mui-active': { color: '#22D3EE' },
                    '&.Mui-completed': { color: '#10B981' },
                },
            },
        },
    },
});
