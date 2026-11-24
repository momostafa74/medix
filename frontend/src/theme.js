import { createTheme, alpha } from '@mui/material/styles';

/** Design tokens — see README "Design system". */
export const tokens = {
  petrol: '#0F4C5C',
  petrolDark: '#0A3742',
  ink: '#13252B',
  inkSoft: '#4A5F66',
  mint: '#E7F3EF',
  paper: '#F6F8F8',
  line: '#DCE5E4',
  saffron: '#E9A23B',
  saffronSoft: '#FCF1DE',
  signal: '#C8432B',
  success: '#2E7D5B',
};

export const theme = createTheme({
  direction: 'rtl',
  palette: {
    mode: 'light',
    primary: { main: tokens.petrol, dark: tokens.petrolDark, contrastText: '#fff' },
    secondary: { main: tokens.saffron, contrastText: tokens.ink },
    error: { main: tokens.signal },
    success: { main: tokens.success },
    warning: { main: '#B7791F' },
    text: { primary: tokens.ink, secondary: tokens.inkSoft },
    background: { default: tokens.paper, paper: '#FFFFFF' },
    divider: tokens.line,
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"IBM Plex Sans Arabic", system-ui, "Segoe UI", Tahoma, sans-serif',
    h1: { fontSize: '2.6rem', fontWeight: 700, lineHeight: 1.25, letterSpacing: 0 },
    h2: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.3 },
    h3: { fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.35 },
    h4: { fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.4 },
    h5: { fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.45 },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
    body1: { fontSize: '1rem', lineHeight: 1.75 },
    body2: { fontSize: '0.92rem', lineHeight: 1.7 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    caption: { fontSize: '0.8rem', lineHeight: 1.6 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFeatureSettings: '"tnum" 1' },
        '*:focus-visible': { outline: `3px solid ${alpha(tokens.saffron, 0.9)}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': { '*': { animation: 'none !important', transition: 'none !important' } },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, paddingInline: 18, minHeight: 42 }, sizeSmall: { minHeight: 32, paddingInline: 12 } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: tokens.line } },
    },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 12 } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#fff' } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: tokens.inkSoft, backgroundColor: tokens.paper, whiteSpace: 'nowrap' },
        root: { borderColor: tokens.line },
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 12 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
