/**
 * Tailwind v4 config.
 * In v4, most configuration lives in globals.css via @theme inline.
 * This file is kept for tool compatibility (IDEs, shadcn CLI).
 */
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", ".dark"] as const,
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
};

export default config;
