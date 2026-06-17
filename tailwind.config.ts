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
          DEFAULT: "#181b21",
          50: "#f5f6f7",
          900: "#0e1014",
          800: "#181b21",
          700: "#23272f",
          600: "#2f343d",
        },
        // Primary text — a clean, near-white neutral grey. High contrast on the
        // dark base for easy reading. (Token kept named `ivory` for legacy reasons.)
        ivory: {
          DEFAULT: "#eceef1",
          muted: "#c7ccd3",
        },
        felt: {
          DEFAULT: "#12382b",
          light: "#1b4d3a",
          dark: "#0c2820",
        },
        // Velvet red — the namesake accent (buttons, highlights, borders, glows).
        velvet: {
          DEFAULT: "#8f1d2c",
          soft: "#b03a48",
          dim: "#5b111d",
        },
        // Secondary text — a neutral grey, lifted for readability on the dark base.
        ash: {
          DEFAULT: "#9aa1ab",
          dim: "#6b727c",
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
        velvet: "0 0 0 1px rgba(143,29,44,0.28)",
      },
      backgroundImage: {
        "felt-radial":
          "radial-gradient(ellipse at center, #1b4d3a 0%, #12382b 55%, #0c2820 100%)",
        "charcoal-fade":
          "linear-gradient(180deg, #181b21 0%, #0e1014 100%)",
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
