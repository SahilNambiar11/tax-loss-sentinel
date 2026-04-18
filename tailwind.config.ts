import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#020617",
        panel: "#0f172a",
        line: "#1e293b",
        glow: "#34d399",
      },
      boxShadow: {
        fintech: "0 0 0 1px rgba(52, 211, 153, 0.08), 0 20px 80px rgba(2, 6, 23, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
