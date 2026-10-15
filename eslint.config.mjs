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
    // Legacy surfaces currently out of active product flow.
    "app/app/tabs/AlertsTab.tsx",
    "app/app/tabs/ExecutionTab.tsx",
    "app/app/tabs/JournalTab.tsx",
    "app/app/tabs/RiskTab.tsx",
    "app/app/tabs/OpportunitiesTab.tsx",
    "components/advisor/**",
    "components/alerts/**",
    "components/copilot/**",
    "components/execution/**",
    "components/journal/**",
    "components/opportunities/**",
    "components/planning/**",
    "components/risk/**",
    "lib/opportunities/supabaseRepo.ts",
    "lib/signalcore/client.ts",
    "lib/signalcore/dailyBundle.brain.ts",
    "lib/signalcore/dailyBundle.ts",
    "lib/signalcore/index.ts",
    "lib/signalcore/server.ts",
    "lib/signalcore/starterPortfolio.ts",
    "lib/signalcore/useDailyBundle.ts",
  ]),
]);

export default eslintConfig;
