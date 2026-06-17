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
        // Cream — the warm light tone that pairs with velvet. Primary text +
        // surfaces lean cream rather than a cold white.
        ivory: {
          DEFAULT: "#f3ecdd",
          muted: "#ddd3bf",
        },
        cream: {
          DEFAULT: "#f3ecdd",
          soft: "#e7dcc6",
          deep: "#cdbfa3",
        },
        felt: {
          DEFAULT: "#12382b",
          light: "#1b4d3a",
          dark: "#0c2820",
        },
        // Velvet red — the namesake accent. (Token is named `gold` for legacy
        // reasons; its value is the deep velvet red used across the UI.)
        gold: {
          DEFAULT: "#8f1d2c",
          soft: "#b03a48",
          dim: "#5b111d",
        },
        // Secondary text — a warm cream-gray (was a cold gray), lifted for
        // readability on the dark base.
        ash: {
          DEFAULT: "#b8b0a0",
          dim: "#8a8275",
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
