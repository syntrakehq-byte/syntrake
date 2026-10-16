import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".cache/**",
    ".codex-chrome-profile/**",
    ".codex-chrome-profile-runtime/**",
    ".qa-*/**",
    ".vercel/**",
    "artifacts/**",
    "Data/**",
    "data/**",
    "undefined/**",
    "*.log",
    "qa_*.mjs",
    "qa_*.json",
    "qa_*.png",
    "tmp_*",
  ]),
]);

export default eslintConfig;
