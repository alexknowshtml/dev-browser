/**
 * Test script that dumps Hacker News DOM tree to a text file
 * using the getLLMTree function and Playwright directly.
 *
 * Usage: bun run dump-hn-tree
 */

import { chromium } from "playwright";
import { getLLMTree } from "../dist/dom/index.js";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("Launching browser...");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Navigating to Hacker News...");
  await page.goto("https://news.ycombinator.com", {
    waitUntil: "networkidle",
  });

  console.log("Extracting LLM tree...");
  const { tree, selectorMap } = await getLLMTree(page);

  const outputPath = join(__dirname, "hn-tree.txt");

  const output = `# Hacker News LLM Tree
# Generated at: ${new Date().toISOString()}
# Selector map entries: ${selectorMap.size}

${tree}
`;

  writeFileSync(outputPath, output);
  console.log(`Tree written to: ${outputPath}`);
  console.log(`Selector map has ${selectorMap.size} entries`);

  await browser.close();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
