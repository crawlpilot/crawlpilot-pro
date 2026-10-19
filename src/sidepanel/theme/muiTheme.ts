/**
 * The side panel's MUI theme, light or dark, kept matching the kit's "Pop" tokens in `index.css` while
 * screens move off MUI (docs/plans/design-system-plan.md). Deleted with MUI in step D7.
 */
import { createTheme, type Theme } from '@mui/material/styles';

export type ColorMode = 'light' | 'dark';

const PALETTES = {
    light: {
        primary: { main: '#16130F', light: '#2E2A24', dark: '#000000', contrastText: '#FFFFFF' },
        secondary: { main: '#C8F03C', light: '#D6F76A', dark: '#A8CC22', contrastText: '#16130F' },
        background: { default: '#FAF7F2', paper: '#FFFFFF' },
        text: { primary: '#16130F', secondary: '#5A534A', disabled: '#A39B90' },
        error: { main: '#CC3338' },
        success: { main: '#0D7F3F' },
        warning: { main: '#A36100' },
        info: { main: '#2563EB' },
        divider: 'rgba(22, 19, 15, 0.10)',
    },
    dark: {
        primary: { main: '#C8F03C', light: '#D6F76A', dark: '#A8CC22', contrastText: '#16130F' },
        secondary: { main: '#C8F03C', light: '#D6F76A', dark: '#A8CC22', contrastText: '#16130F' },
        background: { default: '#121110', paper: '#1C1A18' },
        text: { primary: '#F6F2EA', secondary: '#B9B1A5', disabled: '#6E675E' },
        error: { main: '#FF6369' },
        success: { main: '#3DD68C' },
        warning: { main: '#FFB224' },
        info: { main: '#70A5FF' },
        divider: 'rgba(246, 242, 234, 0.10)',
    },
} as const;

/** Faint overlay of the text colour: hovers, wells, outlines. */
const ink = (mode: ColorMode, a: number) => (mode === 'light' ? `rgba(22, 19, 15, ${a})` : `rgba(246, 242, 234, ${a})`);

const DISPLAY = "'Bricolage Grotesque', 'Geist', system-ui, sans-serif";

export function createAppTheme(mode: ColorMode): Theme {
    const p = PALETTES[mode];
    return createTheme({
        palette: { mode, ...p },
        typography: {
            fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            h1: { fontFamily: DISPLAY, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.2 },
            h2: { fontFamily: DISPLAY, fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.3 },
            h3: { fontFamily: DISPLAY, fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' },
            h5: { fontFamily: DISPLAY, fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.01em' },
            h6: { fontSize: '0.875rem', fontWeight: 600, letterSpacing: '-0.01em' },
            subtitle1: { fontSize: '0.8rem', fontWeight: 500, color: p.text.secondary },
            subtitle2: { fontSize: '0.75rem', fontWeight: 600, color: p.text.primary },
            // Readable sizes: body 13 px, secondary 12.5 px, the smallest 11.5 px.
            body1: { fontSize: '0.8125rem', lineHeight: 1.6 },
            body2: { fontSize: '0.78rem', lineHeight: 1.5, color: p.text.secondary },
            caption: { fontSize: '0.72rem', lineHeight: 1.4, color: p.text.secondary },
            button: { textTransform: 'none', fontWeight: 600, fontSize: '0.8rem', letterSpacing: '0.01em' },
        },
        shape: { borderRadius: 8 },
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    body: {
                        scrollbarWidth: 'thin',
                        '&::-webkit-scrollbar': { width: '6px', height: '6px' },
                        '&::-webkit-scrollbar-track': { background: 'transparent' },
                        '&::-webkit-scrollbar-thumb': { backgroundColor: ink(mode, 0.18), borderRadius: '3px' },
                        '&::-webkit-scrollbar-thumb:hover': { backgroundColor: ink(mode, 0.3) },
                    },
                },
            },
            MuiButton: {
                styleOverrides: {
                    root: { borderRadius: '999px', padding: '6px 16px', boxShadow: 'none', transition: 'background-color .15s, border-color .15s, color .15s', '&:hover': { boxShadow: 'none' } },
                    containedPrimary: {
                        border: `1.5px solid ${p.primary.main}`, boxShadow: `2px 2px 0 0 ${mode === 'light' ? '#16130F' : '#000'}`,
                        '&:hover': { backgroundColor: p.primary.light, boxShadow: `3px 3px 0 0 ${mode === 'light' ? '#16130F' : '#000'}` },
                        '&:active': { boxShadow: 'none', transform: 'translate(2px, 2px)' },
                    },
                    outlined: { borderWidth: '1.5px', borderColor: ink(mode, 0.85), color: p.text.primary, '&:hover': { borderWidth: '1.5px', borderColor: ink(mode, 0.85), backgroundColor: ink(mode, 0.05) } },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: { backgroundImage: 'none', border: `1px solid ${p.divider}`, boxShadow: mode === 'light' ? '0 4px 16px rgba(20, 35, 47, 0.08)' : '0 4px 20px rgba(0, 0, 0, 0.25)' },
                    rounded: { borderRadius: '16px' },
                },
            },
            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        backgroundColor: p.text.primary, color: p.background.default, fontSize: '0.72rem', fontWeight: 500,
                        borderRadius: '6px', padding: '6px 10px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                    },
                    arrow: { color: p.text.primary },
                },
            },
            MuiAlert: { styleOverrides: { root: { borderRadius: '16px', fontSize: '0.78rem' } } },
            MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
            MuiOutlinedInput: { styleOverrides: { root: { borderRadius: '10px' } } },
            MuiDialog: { styleOverrides: { paper: { borderRadius: '22px', border: `1.5px solid ${ink(mode, 0.85)}` } } },
            MuiStepper: { styleOverrides: { root: { background: 'transparent', padding: 0 } } },
            MuiStepLabel: {
                styleOverrides: {
                    label: { fontSize: '0.7rem', fontWeight: 600, '&.Mui-active': { color: p.primary.main }, '&.Mui-completed': { color: p.success.main } },
                },
            },
        },
    });
}
