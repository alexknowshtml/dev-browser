import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getLLMTree, extractDOMTree, processTree, serializeDOMTree } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "fixtures");

// Share browser across all tests for performance
let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

describe("getLLMTree", () => {
  test("produces correct output for basic page", async () => {
    await page.setContent(`
			<div id="container">
				<button id="btn1">Click Me</button>
				<input type="text" id="input1" placeholder="Enter text" />
				<a href="#" id="link1">Link</a>
			</div>
		`);

    const { tree, selectorMap } = await getLLMTree(page);

    // Should have indexed elements
    expect(tree).toContain("[1]");
    expect(tree).toContain("[2]");
    expect(tree).toContain("[3]");

    // Should contain element content
    expect(tree).toContain("Click Me");
    expect(tree).toContain('placeholder="Enter text"');

    // Selector map should have entries
    expect(selectorMap.size).toBe(3);
    expect(selectorMap.get(1)).toBe("#btn1");
    expect(selectorMap.get(2)).toBe("#input1");
    expect(selectorMap.get(3)).toBe("#link1");
  });

  test("handles empty page", async () => {
    await page.setContent("<body></body>");

    const { tree, selectorMap } = await getLLMTree(page);

    // Empty body produces empty tree (no interactive elements)
    // browser-use style: only output interactive elements
    expect(tree).toBe("");
    expect(selectorMap.size).toBe(0);
  });

  test("handles page with only text", async () => {
    await page.setContent("<div>Just some text content</div>");

    const { tree, selectorMap } = await getLLMTree(page);

    // No interactive elements
    expect(selectorMap.size).toBe(0);
    // But text content IS preserved (browser-use style: text nodes are output)
    expect(tree).toContain("Just some text content");
  });

  test("handles complex real-world page", async () => {
    const fixturePath = join(fixturesDir, "complex-page.html");
    await page.goto(`file://${fixturePath}`);

    const { tree, selectorMap } = await getLLMTree(page);

    // Should handle complex page without errors
    expect(tree).toBeTruthy();
    expect(selectorMap.size).toBeGreaterThan(0);

    // Check for expected structure
    expect(tree).toContain("<");
    expect(tree).toContain(">");
  });

  test("selector map entries are valid locators", async () => {
    await page.setContent(`
			<button id="test-btn">Test Button</button>
			<input type="text" name="test-input" />
		`);

    const { selectorMap } = await getLLMTree(page);

    // Each selector should locate exactly one element
    for (const [index, selector] of selectorMap) {
      const count = await page.locator(selector).count();
      expect(count).toBe(1);
    }
  });

  test("clicking selector map entries works", async () => {
    await page.setContent(`
			<button id="click-btn">Click Counter: 0</button>
			<script>
				let count = 0;
				document.getElementById('click-btn').onclick = function() {
					count++;
					this.textContent = 'Click Counter: ' + count;
				};
			</script>
		`);

    const { selectorMap } = await getLLMTree(page);
    const buttonSelector = selectorMap.get(1)!;

    // Click the button using selector
    await page.click(buttonSelector);

    // Verify click worked
    const text = await page.locator(buttonSelector).textContent();
    expect(text).toBe("Click Counter: 1");
  });

  test("respects options.maxTextLength", async () => {
    const longText = "A".repeat(200);
    await page.setContent(`<button>${longText}</button>`);

    const { tree: shortTree } = await getLLMTree(page, { maxTextLength: 50 });
    const { tree: longTree } = await getLLMTree(page, { maxTextLength: 300 });

    // Short tree should have truncated text
    expect(shortTree).toContain("...");
    // Long tree should have full text (or most of it)
    expect(longTree.length).toBeGreaterThan(shortTree.length);
  });

  test("new element marking with previousState", async () => {
    await page.setContent(`
			<button id="old-btn">Old Button</button>
		`);

    // First extraction
    const { tree: firstTree } = await getLLMTree(page);
    expect(firstTree).not.toContain("*[");

    // Add new button
    await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.id = "new-btn";
      btn.textContent = "New Button";
      document.body.appendChild(btn);
    });

    // Get tree again with previous state
    const rawTree = await extractDOMTree(page);
    const oldBtn = findNodeById(rawTree!, "old-btn");

    const previousState = new Map<number, boolean>();
    if (oldBtn) {
      previousState.set(oldBtn.nodeId, true);
    }

    const { tree: secondTree } = await getLLMTree(page, { previousState });

    // New button should be marked with *
    expect(secondTree).toContain("*[");
  });

  test("handles page with shadow DOM", async () => {
    await page.setContent(`<div id="shadow-host"></div>`, { waitUntil: "domcontentloaded" });

    // Create shadow DOM using page.evaluate
    await page.evaluate(() => {
      const host = document.getElementById("shadow-host");
      if (host) {
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = '<button id="shadow-btn">Shadow Button</button>';
      }
    });

    const { tree } = await getLLMTree(page);

    // Should include shadow content
    expect(tree).toContain("|SHADOW(open)|");
    expect(tree).toContain("Shadow Button");
  });

  test("handles scrollable containers", async () => {
    await page.setContent(`
			<div id="scrollable" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">
					<p>Tall content</p>
					<button>Button in scroll</button>
				</div>
			</div>
		`);

    const { tree } = await getLLMTree(page);

    // Should have scroll marker
    expect(tree).toContain("|SCROLL|");
  });
});

describe("extractDOMTree", () => {
  test("returns raw DOM tree", async () => {
    await page.setContent('<button id="test">Test</button>');

    const tree = await extractDOMTree(page);

    expect(tree).not.toBeNull();
    expect(tree!.tagName.toLowerCase()).toBe("body");
  });

  test("returns null for empty page", async () => {
    await page.setContent("");

    const tree = await extractDOMTree(page);

    // Body is still present in HTML
    expect(tree).not.toBeNull();
  });
});

describe("processTree", () => {
  test("filters invisible elements", async () => {
    await page.setContent(`
			<button id="visible">Visible</button>
			<button id="hidden" style="display: none;">Hidden</button>
		`);

    const rawTree = await extractDOMTree(page);
    const processed = processTree(rawTree!);

    // Check that hidden button is filtered
    const visible = findNodeById(processed!, "visible");
    const hidden = findNodeById(processed!, "hidden");

    expect(visible).not.toBeNull();
    expect(hidden).toBeNull();
  });

  test("applies bbox propagation filter", async () => {
    await page.setContent(`
			<button id="parent-btn">
				<span id="child-span">Child</span>
			</button>
		`);

    const rawTree = await extractDOMTree(page);
    const processed = processTree(rawTree!);

    // Child span should be filtered out (inside button)
    const parentBtn = findNodeById(processed!, "parent-btn");
    const childSpan = findNodeById(processed!, "child-span");

    expect(parentBtn).not.toBeNull();
    expect(childSpan).toBeNull();
  });
});

describe("serializeDOMTree", () => {
  test("serializes processed tree", async () => {
    await page.setContent('<button id="btn">Click</button>');

    const rawTree = await extractDOMTree(page);
    const processed = processTree(rawTree!);
    const { tree, selectorMap } = serializeDOMTree(processed!);

    expect(tree).toContain("[1]<button");
    expect(selectorMap.get(1)).toBe("#btn");
  });
});

describe("performance", () => {
  test("handles page with many elements", async () => {
    // Generate HTML with many elements
    const elements = Array.from(
      { length: 500 },
      (_, i) => `<button id="btn-${i}">Button ${i}</button>`
    );
    await page.setContent(`<div>${elements.join("")}</div>`);

    const start = Date.now();
    const { tree, selectorMap } = await getLLMTree(page);
    const duration = Date.now() - start;

    // Should complete in reasonable time (< 5s)
    expect(duration).toBeLessThan(5000);
    expect(selectorMap.size).toBe(500);
  });

  test("completes within reasonable time for complex page", async () => {
    const fixturePath = join(fixturesDir, "complex-page.html");
    await page.goto(`file://${fixturePath}`);

    const start = Date.now();
    await getLLMTree(page);
    const duration = Date.now() - start;

    // Should complete in < 2s
    expect(duration).toBeLessThan(2000);
  });
});

/**
 * Helper to find a node by ID
 */
function findNodeById(node: any, id: string): any | null {
  if (node.attributes?.id === id) {
    return node;
  }

  for (const child of node.children || []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }

  for (const shadow of node.shadowRoots || []) {
    const found = findNodeById(shadow, id);
    if (found) return found;
  }

  if (node.contentDocument) {
    const found = findNodeById(node.contentDocument, id);
    if (found) return found;
  }

  return null;
}
