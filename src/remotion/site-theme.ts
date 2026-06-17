// Mirrors the actual site tokens from tailwind.config.ts and globals.css.
// Keep video art direction constrained to these values and public/ assets only.
export const theme = {
  colors: {
    charcoal: "#16181c",
    charcoal900: "#0c0d10",
    charcoal800: "#16181c",
    charcoal700: "#1f2228",
    charcoal600: "#2b2f37",
    ivory: "#f4f1e8",
    ivoryMuted: "#d9d4c5",
    felt: "#12382b",
    feltLight: "#1b4d3a",
    feltDark: "#0c2820",
    velvet: "#8f1d2c",
    velvetSoft: "#b03a48",
    velvetDim: "#5b111d",
    ash: "#8b8f99",
    ashDim: "#5b5f68",
  },
  fonts: {
    display: 'Georgia, "Times New Roman", serif',
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
  },
  radius: {
    xl: 14,
    xxl: 20,
  },
};
