import { createTheme } from '@mui/material/styles';

export const muiTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#2563EB', // Indigo 600
            light: '#60A5FA', // Indigo 400
            dark: '#1D4ED8', // Indigo 700
            contrastText: '#fff',
        },
        secondary: {
            main: '#22D3EE', // Cyan 400 (AI Accent)
            contrastText: '#0F172A',
        },
        background: {
            default: '#0F172A', // Slate 900
            paper: '#020617', // Slate 950
        },
        text: {
            primary: '#F8FAFC', // Slate 50
            secondary: '#94A3B8', // Slate 400
        },
        error: {
            main: '#EF4444', // Red 500
        },
        success: {
            main: '#22C55E', // Green 500
        },
        warning: {
            main: '#F59E0B', // Amber 500
        },
        divider: 'rgba(148, 163, 184, 0.12)',
    },
    typography: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' },
        h2: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.01em' },
        h3: { fontSize: '1.25rem', fontWeight: 600 },
        h6: { fontSize: '1rem', fontWeight: 600 },
        subtitle1: { fontSize: '0.875rem', fontWeight: 500, color: '#94A3B8' },
        body1: { fontSize: '0.875rem' },
        body2: { fontSize: '0.75rem', color: '#94A3B8' },
        button: { textTransform: 'none', fontWeight: 500 },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: '8px',
                    padding: '8px 16px',
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
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                },
            },
        },
        MuiStepper: {
            styleOverrides: {
                root: {
                    background: 'transparent',
                    padding: 0,
                },
            },
        },
        MuiStepLabel: {
            styleOverrides: {
                label: {
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    '&.Mui-active': {
                        color: '#60A5FA',
                    },
                    '&.Mui-completed': {
                        color: '#22C55E',
                    },
                },
            },
        },
    },
});
