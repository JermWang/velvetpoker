import type { Config } from "tailwindcss";

/**
 * Velvet Poker design tokens.
 * Palette: charcoal / black / ivory / deep green felt / velvet red / soft gray.
 * Restrained, editorial, fintech-grade. No neon, no meme color.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        charcoal: {
          DEFAULT: "#16181c",
          50: "#f5f6f7",
          900: "#0c0d10",
          800: "#16181c",
          700: "#1f2228",
          600: "#2b2f37",
        },
        ivory: {
          DEFAULT: "#f4f1e8",
          muted: "#d9d4c5",
        },
        felt: {
          DEFAULT: "#12382b",
          light: "#1b4d3a",
          dark: "#0c2820",
        },
        gold: {
          DEFAULT: "#8f1d2c",
          soft: "#b03a48",
          dim: "#5b111d",
        },
        ash: {
          DEFAULT: "#8b8f99",
          dim: "#5b5f68",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        elevated: "0 20px 60px -20px rgba(0,0,0,0.7)",
        gold: "0 0 0 1px rgba(143,29,44,0.28)",
      },
      backgroundImage: {
        "felt-radial":
          "radial-gradient(ellipse at center, #1b4d3a 0%, #12382b 55%, #0c2820 100%)",
        "charcoal-fade":
          "linear-gradient(180deg, #16181c 0%, #0c0d10 100%)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
