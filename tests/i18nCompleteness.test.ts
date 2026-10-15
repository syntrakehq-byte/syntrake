import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SITE_LANGS } from "@/lib/i18n/siteLanguage";

const REQUIRED_LANGS = SITE_LANGS;
const SOURCE_ROOTS = ["app", "components", "lib"] as const;

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }

  return out;
}

function getObjectKeys(node: ts.ObjectLiteralExpression): Set<string> {
  const keys = new Set<string>();

  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
      keys.add(prop.name.text);
    }
  }

  return keys;
}

describe("i18n copy completeness", () => {
  it("keeps inline multilingual copy complete for every supported site language", () => {
    const missing: string[] = [];
    const files = SOURCE_ROOTS.flatMap((root) => walkSourceFiles(path.join(process.cwd(), root)));

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const functionName = node.expression.text;
          const copyArgIndex = functionName === "pickByLang" || functionName === "t" ? 1 : -1;
          const copyArg = copyArgIndex >= 0 ? node.arguments[copyArgIndex] : null;

          if (copyArg && ts.isObjectLiteralExpression(copyArg)) {
            const keys = getObjectKeys(copyArg);
            const missingLangs = REQUIRED_LANGS.filter((lang) => !keys.has(lang));

            if (missingLangs.length > 0) {
              const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
              missing.push(`${rel}:${pos.line + 1} missing ${missingLangs.join(",")}`);
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(missing).toEqual([]);
  }, 20_000);
});
