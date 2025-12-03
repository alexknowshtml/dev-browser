import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  resolveBackendIds,
  resolveSelectorFromBackendId,
  isBackendNodeIdValid,
} from "../backend-ids.js";
import { getLLMTree } from "../index.js";

// Declare DOM globals for page.evaluate() callbacks
// These run in browser context, not Node.js
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;

// Share browser across all tests for performance
let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
});

afterAll(async () => {
  await browser.close();
});

describe("resolveBackendIds", () => {
  test("resolves selectors to backend node IDs", async () => {
    await page.setContent(`
			<div id="container">
				<button id="btn1">Click Me</button>
				<input type="text" id="input1" placeholder="Enter text" />
				<a href="#" id="link1">Link</a>
			</div>
		`);

    // Get the selector map from getLLMTree
    const { selectorMap } = await getLLMTree(page);
    expect(selectorMap.size).toBe(3);

    // Resolve to backend node IDs
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    // Should have resolved all elements
    expect(backendNodeMap.size).toBe(3);

    // All values should be positive integers (valid backend node IDs)
    for (const [_index, backendNodeId] of backendNodeMap) {
      expect(typeof backendNodeId).toBe("number");
      expect(backendNodeId).toBeGreaterThan(0);
    }
  });

  test("handles elements without IDs", async () => {
    await page.setContent(`
			<div>
				<button>Button 1</button>
				<button>Button 2</button>
			</div>
		`);

    const { selectorMap } = await getLLMTree(page);
    expect(selectorMap.size).toBe(2);

    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);
    expect(backendNodeMap.size).toBe(2);
  });

  test("returns empty map for empty selector map", async () => {
    await page.setContent("<div>No interactive elements</div>");

    const selectorMap = new Map<number, string>();
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    expect(backendNodeMap.size).toBe(0);
  });

  test("skips selectors that no longer match", async () => {
    await page.setContent('<button id="btn1">Click</button>');

    // Create a selector map with a non-existent element
    const selectorMap = new Map<number, string>([
      [1, "#btn1"],
      [2, "#nonexistent"],
    ]);

    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    // Only the existing element should be resolved
    expect(backendNodeMap.size).toBe(1);
    expect(backendNodeMap.has(1)).toBe(true);
    expect(backendNodeMap.has(2)).toBe(false);
  });
});

describe("resolveSelectorFromBackendId", () => {
  test("resolves backend node ID to selector with ID", async () => {
    await page.setContent('<button id="myButton">Click</button>');

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    const backendNodeId = backendNodeMap.get(1)!;
    const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);

    expect(selector).toBe("#myButton");
  });

  test("resolves backend node ID to selector with data-testid", async () => {
    await page.setContent('<button data-testid="submit-btn">Submit</button>');

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    const backendNodeId = backendNodeMap.get(1)!;
    const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);

    expect(selector).toBe('[data-testid="submit-btn"]');
  });

  test("resolves backend node ID to selector with name attribute", async () => {
    await page.setContent('<input type="text" name="username" />');

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    const backendNodeId = backendNodeMap.get(1)!;
    const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);

    expect(selector).toBe('input[name="username"]');
  });

  test("falls back to nth-of-type path when no unique identifier", async () => {
    await page.setContent(`
			<div>
				<button>First</button>
				<button>Second</button>
			</div>
		`);

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    // Get selector for second button
    const backendNodeId = backendNodeMap.get(2)!;
    const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);

    // Should be a path-based selector
    expect(selector).toContain("button");
    expect(selector).toContain("nth-of-type");

    // Verify the selector works
    const element = await page.$(selector);
    expect(element).not.toBeNull();
    const text = await element!.textContent();
    expect(text).toBe("Second");
  });

  test("generated selector can be used to click element", async () => {
    await page.setContent(`
			<button id="clickable">Click Me</button>
			<div id="result"></div>
			<script>
				document.getElementById('clickable').addEventListener('click', () => {
					document.getElementById('result').textContent = 'clicked';
				});
			</script>
		`);

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    const backendNodeId = backendNodeMap.get(1)!;
    const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);

    // Use the selector to click
    await page.click(selector);

    // Verify click worked
    const result = await page.$eval("#result", (el) => el.textContent);
    expect(result).toBe("clicked");
  });
});

describe("isBackendNodeIdValid", () => {
  test("returns true for existing element", async () => {
    await page.setContent('<button id="btn">Click</button>');

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    const backendNodeId = backendNodeMap.get(1)!;
    const isValid = await isBackendNodeIdValid(page, context, backendNodeId);

    expect(isValid).toBe(true);
  });

  test("returns true for removed element (CDP keeps node in memory)", async () => {
    await page.setContent('<button id="btn">Click</button>');

    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    const backendNodeId = backendNodeMap.get(1)!;

    // Remove the element from DOM
    await page.evaluate(() => {
      document.getElementById("btn")?.remove();
    });

    // Note: CDP keeps backend node IDs valid even after removal
    // The node exists in CDP's internal state until GC or navigation
    // This is expected CDP behavior
    const isValid = await isBackendNodeIdValid(page, context, backendNodeId);
    expect(isValid).toBe(true);

    // CDP can still build a selector from the cached node info
    const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);
    expect(selector).toBe("#btn");

    // However, the selector won't find anything since element is gone
    const element = await page.$(selector);
    expect(element).toBeNull();
  });

  test("returns false for invalid backend node ID", async () => {
    await page.setContent("<button>Click</button>");

    // Use an obviously invalid backend node ID
    const isValid = await isBackendNodeIdValid(page, context, 999999999);
    expect(isValid).toBe(false);
  });
});

describe("getLLMTreeWithBackendIds integration", () => {
  test("full workflow: get tree, store IDs, resolve selectors later", async () => {
    await page.setContent(`
			<form>
				<input type="text" id="name" placeholder="Name" />
				<input type="email" id="email" placeholder="Email" />
				<button type="submit" id="submit">Submit</button>
			</form>
		`);

    // Step 1: Get LLM tree and backend node IDs
    const { selectorMap } = await getLLMTree(page);
    const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

    expect(backendNodeMap.size).toBe(3);

    // Step 2: Store the backend node IDs (simulating server storage)
    const storedIds = new Map(backendNodeMap);

    // Step 3: Later, resolve selectors from stored IDs
    for (const [_index, backendNodeId] of storedIds) {
      const selector = await resolveSelectorFromBackendId(page, context, backendNodeId);

      // Verify each selector works
      const element = await page.$(selector);
      expect(element).not.toBeNull();
    }
  });

  test("handles dynamic content changes", async () => {
    await page.setContent('<button id="btn1">Button 1</button>');

    // Get initial tree
    const { selectorMap: map1 } = await getLLMTree(page);
    const backendMap1 = await resolveBackendIds(page, context, map1);
    const btnId = backendMap1.get(1)!;

    // Add more content
    await page.evaluate(() => {
      const btn2 = document.createElement("button");
      btn2.id = "btn2";
      btn2.textContent = "Button 2";
      document.body.appendChild(btn2);
    });

    // Original backend node ID should still work
    const isValid = await isBackendNodeIdValid(page, context, btnId);
    expect(isValid).toBe(true);

    const selector = await resolveSelectorFromBackendId(page, context, btnId);
    expect(selector).toBe("#btn1");
  });
});
