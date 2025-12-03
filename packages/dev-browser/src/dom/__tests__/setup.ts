import { chromium, Browser, BrowserContext, Page } from "playwright";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const fixturesDir = join(__dirname, "fixtures");

let browser: Browser;
let context: BrowserContext;

export let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
});

afterEach(async () => {
  await context.close();
});

/**
 * Helper to load an HTML fixture file
 */
export async function loadFixture(fixtureName: string): Promise<void> {
  const fixturePath = join(fixturesDir, fixtureName);
  await page.goto(`file://${fixturePath}`);
}

/**
 * Helper to set page content directly for simple tests
 */
export async function setContent(html: string): Promise<void> {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
}
