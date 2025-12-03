import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRawDOM } from "../extract.js";
import {
  isVisible,
  isInViewport,
  filterVisibleNodes,
  hasMeaningfulContent,
} from "../visibility.js";
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

describe("isVisible", () => {
  test("returns false for display:none elements", async () => {
    await page.setContent(`
			<button id="visible">Visible</button>
			<button id="hidden" style="display: none;">Hidden</button>
		`);

    const tree = await extractRawDOM(page);
    const visible = findNodeByAttribute(tree!, "id", "visible");
    const hidden = findNodeByAttribute(tree!, "id", "hidden");

    expect(isVisible(visible!)).toBe(true);
    expect(isVisible(hidden!)).toBe(false);
  });

  test("returns false for visibility:hidden elements", async () => {
    await page.setContent(`
			<button id="visible">Visible</button>
			<button id="hidden" style="visibility: hidden;">Hidden</button>
		`);

    const tree = await extractRawDOM(page);
    const visible = findNodeByAttribute(tree!, "id", "visible");
    const hidden = findNodeByAttribute(tree!, "id", "hidden");

    expect(isVisible(visible!)).toBe(true);
    expect(isVisible(hidden!)).toBe(false);
  });

  test("returns false for opacity:0 elements", async () => {
    await page.setContent(`
			<button id="visible">Visible</button>
			<button id="hidden" style="opacity: 0;">Hidden</button>
		`);

    const tree = await extractRawDOM(page);
    const visible = findNodeByAttribute(tree!, "id", "visible");
    const hidden = findNodeByAttribute(tree!, "id", "hidden");

    expect(isVisible(visible!)).toBe(true);
    expect(isVisible(hidden!)).toBe(false);
  });

  test("returns true for visible elements", async () => {
    await page.setContent(`
			<button id="test-btn">Visible Button</button>
			<div id="test-div" style="opacity: 1; visibility: visible;">Visible Div</div>
		`);

    const tree = await extractRawDOM(page);
    const btn = findNodeByAttribute(tree!, "id", "test-btn");
    const div = findNodeByAttribute(tree!, "id", "test-div");

    expect(isVisible(btn!)).toBe(true);
    expect(isVisible(div!)).toBe(true);
  });

  test("file inputs visible even with opacity:0", async () => {
    await page.setContent(`
			<input type="file" id="file-input" style="opacity: 0;" />
			<button id="regular-btn" style="opacity: 0;">Hidden</button>
		`);

    const tree = await extractRawDOM(page);
    const fileInput = findNodeByAttribute(tree!, "id", "file-input");
    const regularBtn = findNodeByAttribute(tree!, "id", "regular-btn");

    // File input should be visible even with opacity: 0
    expect(isVisible(fileInput!)).toBe(true);
    // Regular button should be hidden
    expect(isVisible(regularBtn!)).toBe(false);
  });

  test("elements with partial opacity are visible", async () => {
    await page.setContent(`
			<button id="half-opacity" style="opacity: 0.5;">Half Opacity</button>
			<button id="low-opacity" style="opacity: 0.1;">Low Opacity</button>
		`);

    const tree = await extractRawDOM(page);
    const halfOpacity = findNodeByAttribute(tree!, "id", "half-opacity");
    const lowOpacity = findNodeByAttribute(tree!, "id", "low-opacity");

    expect(isVisible(halfOpacity!)).toBe(true);
    expect(isVisible(lowOpacity!)).toBe(true);
  });

  test("handles visibility fixture correctly", async () => {
    const fixturePath = join(fixturesDir, "visibility.html");
    await page.goto(`file://${fixturePath}`);

    const tree = await extractRawDOM(page);

    // Visible elements
    const visibleBtn = findNodeByAttribute(tree!, "id", "visible-button");
    expect(isVisible(visibleBtn!)).toBe(true);

    // display: none
    const displayNoneBtn = findNodeByAttribute(tree!, "id", "display-none-button");
    expect(isVisible(displayNoneBtn!)).toBe(false);

    // visibility: hidden
    const visibilityHiddenBtn = findNodeByAttribute(tree!, "id", "visibility-hidden-button");
    expect(isVisible(visibilityHiddenBtn!)).toBe(false);

    // opacity: 0
    const opacityZeroBtn = findNodeByAttribute(tree!, "id", "opacity-zero-button");
    expect(isVisible(opacityZeroBtn!)).toBe(false);

    // file input with opacity: 0 (should be visible)
    const fileInputOpacity = findNodeByAttribute(tree!, "id", "file-input-opacity-zero");
    expect(isVisible(fileInputOpacity!)).toBe(true);

    // opacity: 0.5 (should be visible)
    const opacityHalfBtn = findNodeByAttribute(tree!, "id", "opacity-half-button");
    expect(isVisible(opacityHalfBtn!)).toBe(true);
  });
});

describe("isInViewport", () => {
  test("returns true for element fully in viewport", () => {
    const rect = { x: 100, y: 100, width: 50, height: 50 };
    expect(isInViewport(rect, 800, 600)).toBe(true);
  });

  test("returns true for element partially in viewport", () => {
    const rect = { x: -25, y: 100, width: 50, height: 50 };
    expect(isInViewport(rect, 800, 600)).toBe(true);
  });

  test("returns false for element completely above viewport", () => {
    const rect = { x: 100, y: -100, width: 50, height: 50 };
    expect(isInViewport(rect, 800, 600)).toBe(false);
  });

  test("returns false for element completely below viewport", () => {
    const rect = { x: 100, y: 700, width: 50, height: 50 };
    expect(isInViewport(rect, 800, 600)).toBe(false);
  });

  test("returns false for element completely left of viewport", () => {
    const rect = { x: -100, y: 100, width: 50, height: 50 };
    expect(isInViewport(rect, 800, 600)).toBe(false);
  });

  test("returns false for element completely right of viewport", () => {
    const rect = { x: 900, y: 100, width: 50, height: 50 };
    expect(isInViewport(rect, 800, 600)).toBe(false);
  });

  test("handles scroll position", () => {
    const rect = { x: 100, y: 700, width: 50, height: 50 };
    // Without scroll, element is below viewport
    expect(isInViewport(rect, 800, 600, 0, 0)).toBe(false);
    // With scroll, element is in viewport
    expect(isInViewport(rect, 800, 600, 0, 200)).toBe(true);
  });
});

describe("filterVisibleNodes", () => {
  test("removes display:none elements", async () => {
    await page.setContent(`
			<div id="parent">
				<button id="visible">Visible</button>
				<button id="hidden" style="display: none;">Hidden</button>
			</div>
		`);

    const tree = await extractRawDOM(page);
    const filtered = filterVisibleNodes(tree!);

    const visible = findNodeByAttribute(filtered!, "id", "visible");
    const hidden = findNodeByAttribute(filtered!, "id", "hidden");

    expect(visible).not.toBeNull();
    expect(hidden).toBeNull();
  });

  test("removes children of hidden parents", async () => {
    await page.setContent(`
			<div id="hidden-parent" style="display: none;">
				<button id="child-of-hidden">Child</button>
			</div>
			<button id="visible-btn">Visible</button>
		`);

    const tree = await extractRawDOM(page);
    const filtered = filterVisibleNodes(tree!);

    const hiddenParent = findNodeByAttribute(filtered!, "id", "hidden-parent");
    const childOfHidden = findNodeByAttribute(filtered!, "id", "child-of-hidden");
    const visibleBtn = findNodeByAttribute(filtered!, "id", "visible-btn");

    expect(hiddenParent).toBeNull();
    expect(childOfHidden).toBeNull();
    expect(visibleBtn).not.toBeNull();
  });

  test("preserves tree structure for visible nodes", async () => {
    await page.setContent(`
			<div id="parent">
				<div id="child1">
					<button id="grandchild1">Button 1</button>
				</div>
				<div id="child2" style="display: none;">
					<button id="grandchild2">Button 2</button>
				</div>
				<div id="child3">
					<button id="grandchild3">Button 3</button>
				</div>
			</div>
		`);

    const tree = await extractRawDOM(page);
    const filtered = filterVisibleNodes(tree!);

    const parent = findNodeByAttribute(filtered!, "id", "parent");
    const child1 = findNodeByAttribute(filtered!, "id", "child1");
    const child2 = findNodeByAttribute(filtered!, "id", "child2");
    const child3 = findNodeByAttribute(filtered!, "id", "child3");
    const grandchild1 = findNodeByAttribute(filtered!, "id", "grandchild1");
    const grandchild2 = findNodeByAttribute(filtered!, "id", "grandchild2");
    const grandchild3 = findNodeByAttribute(filtered!, "id", "grandchild3");

    expect(parent).not.toBeNull();
    expect(child1).not.toBeNull();
    expect(child2).toBeNull(); // Hidden
    expect(child3).not.toBeNull();
    expect(grandchild1).not.toBeNull();
    expect(grandchild2).toBeNull(); // Child of hidden
    expect(grandchild3).not.toBeNull();
  });
});

describe("hasMeaningfulContent", () => {
  test("returns true for element with text", async () => {
    await page.setContent(`<div id="with-text">Hello World</div>`);

    const tree = await extractRawDOM(page);
    const div = findNodeByAttribute(tree!, "id", "with-text");

    expect(hasMeaningfulContent(div!)).toBe(true);
  });

  test("returns false for empty element", async () => {
    await page.setContent(`<div id="empty"></div>`);

    const tree = await extractRawDOM(page);
    const div = findNodeByAttribute(tree!, "id", "empty");

    expect(hasMeaningfulContent(div!)).toBe(false);
  });

  test("returns true for element with text in children", async () => {
    await page.setContent(`
			<div id="parent">
				<span>Child text</span>
			</div>
		`);

    const tree = await extractRawDOM(page);
    const parent = findNodeByAttribute(tree!, "id", "parent");

    expect(hasMeaningfulContent(parent!)).toBe(true);
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
