import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "!./app/api/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f7f8",
          100: "#e7ebee",
          200: "#cfd7dc",
          300: "#a9b6bf",
          400: "#7d8f9b",
          500: "#5f707c",
          600: "#4a5862",
          700: "#3c4750",
          800: "#252d33",
          900: "#11161b",
        },
        signal: {
          50: "#ecfdf6",
          100: "#d2faea",
          200: "#aaf3d7",
          300: "#77e8bf",
          400: "#3fd8a1",
          500: "#18bf85",
          600: "#0f986b",
          700: "#0e6b4f",
          800: "#0f553f",
          900: "#0d4635",
        },
        canvas: {
          50: "#f7faf8",
        },
        "border-soft": "#e4eaee",
      },
      boxShadow: {
        soft: "0 8px 24px rgba(17, 22, 27, 0.06)",
        card: "0 16px 42px rgba(17, 22, 27, 0.1)",
      },
    },
  },
  plugins: [],
};

export default config;
