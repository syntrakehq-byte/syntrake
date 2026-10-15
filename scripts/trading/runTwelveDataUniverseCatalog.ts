import { loadResearchConfig, runTwelveDataUniverseCatalog } from "../../lib/trading/research/index";

function parseOutputDir(argv: string[]): string | null | undefined {
  const raw = argv.find((arg) => arg.startsWith("--outputDir="));
  if (!raw) {
    return undefined;
  }
  return raw.slice("--outputDir=".length).trim() || null;
}

async function main() {
  await loadResearchConfig();
  const argv = process.argv.slice(2);
  const report = await runTwelveDataUniverseCatalog({
    outputDir: parseOutputDir(argv),
  });

  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
