import { createTheme } from '@mui/material/styles';

export const muiTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#9333EA', // Vibrant Purple (Gemini/AI vibe)
            light: '#C084FC',
            dark: '#7E22CE',
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#06B6D4', // Vibrant Cyan accent
            contrastText: '#0F172A',
        },
        background: {
            default: '#030712', // Deep Space Black/Blue
            paper: '#0B0F19',   // Very dark, slightly tinted slate
        },
        text: {
            primary: '#F8FAFC',
            secondary: '#A1A1AA', // Zinc 400 (softer than slate)
        },
        error: { main: '#F43F5E' },
        success: { main: '#10B981' },
        warning: { main: '#F59E0B' },
        divider: 'rgba(255, 255, 255, 0.08)', // Very sheer, clean divider
    },
    typography: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        h1: { fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.2 },
        h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
        h3: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.01em' },
        h6: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em' },
        subtitle1: { fontSize: '0.875rem', fontWeight: 500, color: '#A1A1AA' },
        subtitle2: { fontSize: '0.8125rem', fontWeight: 600, color: '#F8FAFC' },
        body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
        body2: { fontSize: '0.8125rem', lineHeight: 1.5, color: '#A1A1AA' },
        button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
    },
    shape: {
        borderRadius: 16,
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: '12px',
                    padding: '8px 16px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(147, 51, 234, 0.2)', // Soft purple glow
                    },
                    '&:active': {
                        transform: 'translateY(1px)',
                        boxShadow: 'none',
                    }
                },
                containedPrimary: {
                    background: 'linear-gradient(135deg, #A855F7 0%, #7E22CE 100%)',
                    '&:hover': {
                        background: 'linear-gradient(135deg, #C084FC 0%, #9333EA 100%)',
                    },
                },
                outlined: {
                    borderColor: 'rgba(255,255,255,0.15)',
                    '&:hover': {
                        borderColor: 'rgba(255,255,255,0.3)',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                    }
                }
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    border: '1px solid rgba(255, 255, 255, 0.08)', // Clean, sheer glassmorphism line
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
                },
                rounded: {
                    borderRadius: '16px',
                }
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
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    '&.Mui-active': {
                        color: '#C084FC', // Bright purple active step
                    },
                    '&.Mui-completed': {
                        color: '#10B981', // Clean green complete step
                    },
                },
            },
        },
    },
});
