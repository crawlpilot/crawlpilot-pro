/**
 * The side panel's MUI theme, light or dark (docs/plans/ux-simplification-plan.md §4.7). Light is the
 * default and follows the website's Daylight look: white surfaces, near-black text and buttons, amber
 * as the one accent. The colours match the `--cp-*` variables in `index.css`, which raw `sx` values use.
 */
import { createTheme, type Theme } from '@mui/material/styles';

export type ColorMode = 'light' | 'dark';

const PALETTES = {
    light: {
        primary: { main: '#14232F', light: '#3A4D5C', dark: '#0B151D', contrastText: '#FFFFFF' },
        secondary: { main: '#B87514', light: '#D9952F', dark: '#8F5A0E', contrastText: '#FFFFFF' },
        background: { default: '#F6F7F9', paper: '#FFFFFF' },
        text: { primary: '#14232F', secondary: '#51606D', disabled: '#9AA4AE' },
        error: { main: '#D23A4A' },
        success: { main: '#0F8A60' },
        warning: { main: '#B87514' },
        info: { main: '#0E7490' },
        divider: 'rgba(20, 35, 47, 0.10)',
    },
    dark: {
        primary: { main: '#06B6D4', light: '#22D3EE', dark: '#0891B2', contrastText: '#FFFFFF' },
        secondary: { main: '#8B5CF6', light: '#A78BFA', dark: '#7C3AED', contrastText: '#FFFFFF' },
        background: { default: '#030712', paper: '#0B0F19' },
        text: { primary: '#F8FAFC', secondary: '#94A3B8', disabled: '#5B6675' },
        error: { main: '#F43F5E' },
        success: { main: '#10B981' },
        warning: { main: '#F59E0B' },
        info: { main: '#22D3EE' },
        divider: 'rgba(255, 255, 255, 0.08)',
    },
} as const;

/** Faint overlay of the text colour: hovers, wells, outlines. */
const ink = (mode: ColorMode, a: number) => (mode === 'light' ? `rgba(20, 35, 47, ${a})` : `rgba(255, 255, 255, ${a})`);

export function createAppTheme(mode: ColorMode): Theme {
    const p = PALETTES[mode];
    return createTheme({
        palette: { mode, ...p },
        typography: {
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            h1: { fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.2 },
            h2: { fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.3 },
            h3: { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' },
            h5: { fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.01em' },
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
                    root: { borderRadius: '8px', padding: '6px 14px', boxShadow: 'none', transition: 'background-color .15s, border-color .15s, color .15s', '&:hover': { boxShadow: 'none' } },
                    containedPrimary: { '&:hover': { backgroundColor: p.primary.light } },
                    outlined: { borderColor: ink(mode, 0.16), '&:hover': { borderColor: ink(mode, 0.32), backgroundColor: ink(mode, 0.03) } },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: { backgroundImage: 'none', border: `1px solid ${p.divider}`, boxShadow: mode === 'light' ? '0 4px 16px rgba(20, 35, 47, 0.08)' : '0 4px 20px rgba(0, 0, 0, 0.25)' },
                    rounded: { borderRadius: '10px' },
                },
            },
            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        backgroundColor: mode === 'light' ? '#14232F' : '#1E293B', color: '#F8FAFC', fontSize: '0.72rem', fontWeight: 500,
                        borderRadius: '6px', padding: '6px 10px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                    },
                    arrow: { color: mode === 'light' ? '#14232F' : '#1E293B' },
                },
            },
            MuiAlert: { styleOverrides: { root: { borderRadius: '10px', fontSize: '0.78rem' } } },
            MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
            MuiStepper: { styleOverrides: { root: { background: 'transparent', padding: 0 } } },
            MuiStepLabel: {
                styleOverrides: {
                    label: { fontSize: '0.7rem', fontWeight: 600, '&.Mui-active': { color: p.primary.main }, '&.Mui-completed': { color: p.success.main } },
                },
            },
        },
    });
}
