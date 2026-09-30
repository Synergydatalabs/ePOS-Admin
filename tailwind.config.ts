// Tailwind for tapapp-admin. Indigo primary (operator tools, not merchant-facing).
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#4f46e5", // indigo-600
        primaryDark: "#4338ca", // indigo-700
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
