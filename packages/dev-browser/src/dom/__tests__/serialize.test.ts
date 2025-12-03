import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRawDOM } from "../extract.js";
import {
  buildSelector,
  buildAttributeString,
  truncateText,
  getScrollInfo,
  serializeTree,
  assignIndices,
  buildSelectorMap,
} from "../serialize.js";
import type { RawDOMNode } from "../types.js";

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

async function setContent(html: string): Promise<RawDOMNode> {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  return (await extractRawDOM(page))!;
}

async function loadFixture(name: string): Promise<RawDOMNode> {
  const fixturePath = join(fixturesDir, name);
  await page.goto(`file://${fixturePath}`);
  return (await extractRawDOM(page))!;
}

describe("buildSelector", () => {
  test("prefers id selector when available", async () => {
    const tree = await setContent(`<button id="my-btn">Click</button>`);
    const btn = findNodeByAttribute(tree, "id", "my-btn");
    const selector = buildSelector(btn!, []);
    expect(selector).toBe("#my-btn");
  });

  test("uses data-testid when no id", async () => {
    const tree = await setContent(`<button data-testid="test-btn">Click</button>`);
    const btn = findNodeByTagName(tree, "button");
    const selector = buildSelector(btn!, [tree]);
    expect(selector).toBe('[data-testid="test-btn"]');
  });

  test("uses name attribute for form elements", async () => {
    const tree = await setContent(`<input type="text" name="username" />`);
    const input = findNodeByTagName(tree, "input");
    const selector = buildSelector(input!, [tree]);
    expect(selector).toBe('input[name="username"]');
  });

  test("builds nth-child path as fallback", async () => {
    const tree = await setContent(`
			<div>
				<button>First</button>
				<button>Second</button>
			</div>
		`);
    const buttons = findAllNodesByTagName(tree, "button");
    expect(buttons.length).toBe(2);

    // Second button should use nth-of-type
    const selector = buildSelector(buttons[1], [tree, findNodeByTagName(tree, "div")!]);
    expect(selector).toContain("button:nth-of-type(2)");
  });

  test("escapes special characters in id", async () => {
    const tree = await setContent(`<button id="my.btn">Click</button>`);
    const btn = findNodeByAttribute(tree, "id", "my.btn");
    const selector = buildSelector(btn!, []);
    expect(selector).toBe("#my\\.btn");
  });
});

describe("buildAttributeString", () => {
  test("includes specified attributes", async () => {
    const tree = await setContent(`
			<input type="text" id="test" name="username" placeholder="Enter name" />
		`);
    const input = findNodeByAttribute(tree, "id", "test");
    const attrString = buildAttributeString(input!, ["type", "name", "placeholder"]);
    expect(attrString).toContain('type="text"');
    expect(attrString).toContain('name="username"');
    expect(attrString).toContain('placeholder="Enter name"');
  });

  test("skips empty attributes", async () => {
    const tree = await setContent(`<button id="btn">Click</button>`);
    const btn = findNodeByAttribute(tree, "id", "btn");
    const attrString = buildAttributeString(btn!, ["type", "id", "name"]);
    expect(attrString).toContain('id="btn"');
    expect(attrString).not.toContain("name");
    // button has type="submit" by default
  });

  test("deduplicates attribute values", async () => {
    const tree = await setContent(`<button id="submit" name="submit">Submit</button>`);
    const btn = findNodeByAttribute(tree, "id", "submit");
    const attrString = buildAttributeString(btn!, ["id", "name"]);
    // Only one "submit" should appear
    const submitCount = (attrString.match(/submit/g) || []).length;
    expect(submitCount).toBe(1);
  });

  test("escapes special characters in values", async () => {
    const tree = await setContent(`<button aria-label="Say &quot;hello&quot;">Click</button>`);
    const btn = findNodeByTagName(tree, "button");
    const attrString = buildAttributeString(btn!, ["aria-label"]);
    // Should escape quotes
    expect(attrString).toContain("aria-label=");
  });
});

describe("truncateText", () => {
  test("returns text unchanged if under limit", () => {
    const text = "Hello World";
    expect(truncateText(text, 100)).toBe("Hello World");
  });

  test("truncates long text with ellipsis", () => {
    const text = "A".repeat(150);
    const result = truncateText(text, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith("...")).toBe(true);
  });

  test("normalizes whitespace", () => {
    const text = "  Hello   World  \n  Test  ";
    expect(truncateText(text, 100)).toBe("Hello World Test");
  });

  test("handles empty text", () => {
    expect(truncateText("", 100)).toBe("");
  });
});

describe("getScrollInfo", () => {
  test("returns empty for non-scrollable elements", async () => {
    const tree = await setContent(`<div id="div">Content</div>`);
    const div = findNodeByAttribute(tree, "id", "div");
    expect(getScrollInfo(div!)).toBe("");
  });

  test("returns scroll info for scrollable elements", async () => {
    await page.setContent(`
			<div id="scroll-container" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">Tall content</div>
			</div>
		`);

    // Scroll to middle
    await page.evaluate(() => {
      const container = document.getElementById("scroll-container");
      if (container) container.scrollTop = 100;
    });

    const tree = await extractRawDOM(page);
    const container = findNodeByAttribute(tree!, "id", "scroll-container");

    expect(container?.isScrollable).toBe(true);
    const scrollInfo = getScrollInfo(container!);
    expect(scrollInfo).toMatch(/\d+\.\d+ pages above/);
    expect(scrollInfo).toMatch(/\d+\.\d+ pages below/);
  });
});

describe("serializeTree", () => {
  test("formats interactive elements with [N] prefix", async () => {
    const tree = await setContent(`
			<button id="btn1">First</button>
			<button id="btn2">Second</button>
		`);

    const { tree: treeStr, selectorMap } = serializeTree(tree);

    expect(treeStr).toContain("[1]<button");
    expect(treeStr).toContain("[2]<button");
    expect(selectorMap.size).toBe(2);
  });

  test("outputs flat structure without nesting for structural elements", async () => {
    const tree = await setContent(`
			<div>
				<button>Nested</button>
			</div>
		`);

    const { tree: treeStr } = serializeTree(tree);
    const lines = treeStr.split("\n").filter((l) => l.trim());

    // Button should NOT be indented - flat output
    const buttonLine = lines.find((l) => l.includes("<button"));
    expect(buttonLine).not.toMatch(/^\t/);

    // Should not output the div wrapper
    expect(treeStr).not.toContain("<div");
  });

  test("uses self-closing tags for empty elements", async () => {
    const tree = await setContent(`<input type="text" id="input" />`);

    const { tree: treeStr } = serializeTree(tree);
    expect(treeStr).toContain("/>");
  });

  test("adds |SCROLL| marker for scrollable containers", async () => {
    const tree = await setContent(`
			<div id="scrollable" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">Tall content</div>
			</div>
		`);

    const { tree: treeStr } = serializeTree(tree);
    expect(treeStr).toContain("|SCROLL|");
  });

  test("includes text content inline", async () => {
    const tree = await setContent(`<button>Click Me</button>`);

    const { tree: treeStr } = serializeTree(tree);
    expect(treeStr).toContain(">Click Me</button>");
  });

  test("truncates long text content", async () => {
    const longText = "A".repeat(200);
    const tree = await setContent(`<button>${longText}</button>`);

    const { tree: treeStr } = serializeTree(tree, { maxTextLength: 50 });
    expect(treeStr).toContain("...");
  });

  test("handles shadow DOM with marker", async () => {
    await page.setContent(`
			<div id="shadow-host"></div>
			<script>
				const host = document.getElementById('shadow-host');
				const shadow = host.attachShadow({ mode: 'open' });
				shadow.innerHTML = '<button>Shadow Button</button>';
			</script>
		`);

    await page.waitForFunction(() => {
      const host = document.getElementById("shadow-host");
      return host?.shadowRoot?.querySelector("button");
    });

    const tree = await extractRawDOM(page);
    const { tree: treeStr } = serializeTree(tree!);

    expect(treeStr).toContain("|SHADOW(open)|");
  });

  test("marks new elements with *[N]", async () => {
    const tree = await setContent(`
			<button id="btn1">First</button>
			<button id="btn2">Second</button>
		`);

    // First call - no previous state
    const { tree: firstTree } = serializeTree(tree);
    expect(firstTree).not.toContain("*[");

    // Second call with previous state (simulating that btn2 is new)
    const previousState = new Map<number, boolean>();
    const btn1 = findNodeByAttribute(tree, "id", "btn1");
    previousState.set(btn1!.nodeId, true);

    const { tree: secondTree } = serializeTree(tree, { previousState });
    // btn2 should be marked as new since it's not in previousState
    expect(secondTree).toContain("*[");
  });
});

describe("assignIndices", () => {
  test("assigns sequential indices to interactive elements", async () => {
    const tree = await setContent(`
			<button id="btn1">First</button>
			<button id="btn2">Second</button>
			<div id="div">Not interactive</div>
			<a href="#" id="link">Link</a>
		`);

    const nodeToIndex = assignIndices(tree);

    const btn1 = findNodeByAttribute(tree, "id", "btn1");
    const btn2 = findNodeByAttribute(tree, "id", "btn2");
    const div = findNodeByAttribute(tree, "id", "div");
    const link = findNodeByAttribute(tree, "id", "link");

    expect(nodeToIndex.get(btn1!.nodeId)).toBe(1);
    expect(nodeToIndex.get(btn2!.nodeId)).toBe(2);
    expect(nodeToIndex.has(div!.nodeId)).toBe(false);
    expect(nodeToIndex.get(link!.nodeId)).toBe(3);
  });

  test("skips hidden elements", async () => {
    const tree = await setContent(`
			<button id="visible">Visible</button>
			<button id="hidden" style="display: none;">Hidden</button>
		`);

    const nodeToIndex = assignIndices(tree);

    const visible = findNodeByAttribute(tree, "id", "visible");
    const hidden = findNodeByAttribute(tree, "id", "hidden");

    expect(nodeToIndex.get(visible!.nodeId)).toBe(1);
    expect(nodeToIndex.has(hidden!.nodeId)).toBe(false);
  });
});

describe("buildSelectorMap", () => {
  test("builds selector map from indices", async () => {
    const tree = await setContent(`
			<button id="btn1">First</button>
			<input type="text" name="username" />
		`);

    const nodeToIndex = assignIndices(tree);
    const selectorMap = buildSelectorMap(tree, nodeToIndex);

    expect(selectorMap.get(1)).toBe("#btn1");
    expect(selectorMap.get(2)).toContain("input");
  });

  test("selectors are valid Playwright locators", async () => {
    const tree = await setContent(`
			<button id="test-btn">Click Me</button>
		`);

    const nodeToIndex = assignIndices(tree);
    const selectorMap = buildSelectorMap(tree, nodeToIndex);

    // The selector should work with Playwright
    const selector = selectorMap.get(1)!;
    const element = await page.locator(selector).count();
    expect(element).toBe(1);
  });
});

describe("serializeTree integration", () => {
  test("handles basic fixture correctly", async () => {
    const tree = await loadFixture("basic.html");
    const { tree: treeStr, selectorMap } = serializeTree(tree);

    // Should have indexed elements
    expect(treeStr).toContain("[");
    expect(selectorMap.size).toBeGreaterThan(0);

    // Known elements from basic.html should be present
    expect(treeStr).toContain("submit-btn");
    expect(treeStr).toContain("username");
  });

  test("handles complex page structure", async () => {
    const tree = await loadFixture("complex-page.html");
    const { tree: treeStr, selectorMap } = serializeTree(tree);

    // Should handle complex page without errors
    expect(treeStr).toBeTruthy();
    expect(selectorMap.size).toBeGreaterThan(0);

    // Verify output format
    const lines = treeStr.split("\n");
    const interactiveLines = lines.filter((l) => l.includes("["));
    expect(interactiveLines.length).toBeGreaterThan(0);
  });
});

/**
 * Helper to find a node by attribute value
 */
function findNodeByAttribute(
  node: RawDOMNode,
  attrName: string,
  attrValue: string
): RawDOMNode | null {
  if (node.attributes[attrName] === attrValue) {
    return node;
  }

  for (const child of node.children) {
    const found = findNodeByAttribute(child, attrName, attrValue);
    if (found) return found;
  }

  for (const shadow of node.shadowRoots) {
    const found = findNodeByAttribute(shadow, attrName, attrValue);
    if (found) return found;
  }

  if (node.contentDocument) {
    const found = findNodeByAttribute(node.contentDocument, attrName, attrValue);
    if (found) return found;
  }

  return null;
}

/**
 * Helper to find a node by tag name
 */
function findNodeByTagName(node: RawDOMNode, tagName: string): RawDOMNode | null {
  if (node.tagName.toLowerCase() === tagName.toLowerCase()) {
    return node;
  }

  for (const child of node.children) {
    const found = findNodeByTagName(child, tagName);
    if (found) return found;
  }

  for (const shadow of node.shadowRoots) {
    const found = findNodeByTagName(shadow, tagName);
    if (found) return found;
  }

  return null;
}

/**
 * Helper to find all nodes by tag name
 */
function findAllNodesByTagName(node: RawDOMNode, tagName: string): RawDOMNode[] {
  const results: RawDOMNode[] = [];

  if (node.tagName.toLowerCase() === tagName.toLowerCase()) {
    results.push(node);
  }

  for (const child of node.children) {
    results.push(...findAllNodesByTagName(child, tagName));
  }

  for (const shadow of node.shadowRoots) {
    results.push(...findAllNodesByTagName(shadow, tagName));
  }

  return results;
}
