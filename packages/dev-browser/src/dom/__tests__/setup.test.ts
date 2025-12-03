import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "fixtures");

describe("Test Setup Verification", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

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

  test("browser launches successfully", () => {
    expect(browser).toBeDefined();
    expect(browser.isConnected()).toBe(true);
  });

  test("page loads basic fixture", async () => {
    const fixturePath = join(fixturesDir, "basic.html");
    await page.goto(`file://${fixturePath}`);

    const title = await page.title();
    expect(title).toBe("Basic Elements Test");
  });

  test("page can find elements in fixture", async () => {
    const fixturePath = join(fixturesDir, "basic.html");
    await page.goto(`file://${fixturePath}`);

    const button = await page.$("#submit-btn");
    expect(button).not.toBeNull();

    const buttonText = await button?.textContent();
    expect(buttonText).toBe("Submit");
  });

  test("page can set content directly", async () => {
    await page.setContent('<button id="test-btn">Test</button>');

    const button = await page.$("#test-btn");
    expect(button).not.toBeNull();
  });

  test("can access all fixture files", async () => {
    const fixtures = [
      "basic.html",
      "visibility.html",
      "interactive.html",
      "scroll.html",
      "shadow-dom.html",
      "iframes.html",
      "paint-order.html",
      "bbox-propagation.html",
      "compound.html",
      "complex-page.html",
    ];

    for (const fixture of fixtures) {
      const fixturePath = join(fixturesDir, fixture);
      await page.goto(`file://${fixturePath}`);
      // Should not throw
      expect(await page.title()).toBeDefined();
    }
  });
});
