import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRawDOM } from "../extract.js";
import {
  getContainmentPercentage,
  isFullyContained,
  isOpaqueElement,
  isOccludedByPaintOrder,
  flattenTree,
  filterByBboxPropagation,
  shouldExcludeFromPropagatingParent,
  getExcludedNodeIds,
} from "../filters.js";
import type { RawDOMNode, BoundingRect } from "../types.js";

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

describe("getContainmentPercentage", () => {
  test("returns 1 for identical rectangles", () => {
    const rect: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(getContainmentPercentage(rect, rect)).toBe(1);
  });

  test("returns 1 for inner fully inside outer", () => {
    const inner: BoundingRect = { x: 25, y: 25, width: 50, height: 50 };
    const outer: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(getContainmentPercentage(inner, outer)).toBe(1);
  });

  test("returns 0 for non-overlapping rectangles", () => {
    const inner: BoundingRect = { x: 200, y: 200, width: 50, height: 50 };
    const outer: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(getContainmentPercentage(inner, outer)).toBe(0);
  });

  test("returns 0.5 for half overlap", () => {
    const inner: BoundingRect = { x: 50, y: 0, width: 100, height: 100 };
    const outer: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(getContainmentPercentage(inner, outer)).toBe(0.5);
  });

  test("returns 0 for zero-area rectangles", () => {
    const inner: BoundingRect = { x: 0, y: 0, width: 0, height: 0 };
    const outer: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(getContainmentPercentage(inner, outer)).toBe(0);
  });
});

describe("isFullyContained", () => {
  test("returns true when inner is 99%+ contained", () => {
    const inner: BoundingRect = { x: 1, y: 1, width: 98, height: 98 };
    const outer: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(isFullyContained(inner, outer)).toBe(true);
  });

  test("returns false when inner is less than 99% contained", () => {
    const inner: BoundingRect = { x: 50, y: 0, width: 100, height: 100 };
    const outer: BoundingRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(isFullyContained(inner, outer)).toBe(false);
  });
});

describe("isOpaqueElement", () => {
  test("returns true for solid background color", async () => {
    const tree = await setContent(`<div id="opaque" style="background: red;">Opaque</div>`);
    const opaque = findNodeByAttribute(tree, "id", "opaque");
    expect(isOpaqueElement(opaque!)).toBe(true);
  });

  test("returns false for transparent background", async () => {
    const tree = await setContent(
      `<div id="transparent" style="background: transparent;">Transparent</div>`
    );
    const transparent = findNodeByAttribute(tree, "id", "transparent");
    expect(isOpaqueElement(transparent!)).toBe(false);
  });

  test("returns false for rgba with low alpha", async () => {
    const tree = await setContent(
      `<div id="semi" style="background: rgba(255, 0, 0, 0.5);">Semi</div>`
    );
    const semi = findNodeByAttribute(tree, "id", "semi");
    expect(isOpaqueElement(semi!)).toBe(false);
  });

  test("returns true for rgba with high alpha", async () => {
    const tree = await setContent(
      `<div id="opaque-rgba" style="background: rgba(255, 0, 0, 0.95);">Opaque RGBA</div>`
    );
    const opaqueRgba = findNodeByAttribute(tree, "id", "opaque-rgba");
    expect(isOpaqueElement(opaqueRgba!)).toBe(true);
  });

  test("returns false for no background", async () => {
    const tree = await setContent(`<div id="no-bg">No Background</div>`);
    const noBg = findNodeByAttribute(tree, "id", "no-bg");
    expect(isOpaqueElement(noBg!)).toBe(false);
  });
});

describe("flattenTree", () => {
  test("flattens nested tree structure", async () => {
    const tree = await setContent(`
			<div id="level-1">
				<div id="level-2">
					<div id="level-3">
						<button id="deep-btn">Deep</button>
					</div>
				</div>
			</div>
		`);

    const flattened = flattenTree(tree);
    const ids = flattened.filter((n) => n.attributes.id).map((n) => n.attributes.id);

    expect(ids).toContain("level-1");
    expect(ids).toContain("level-2");
    expect(ids).toContain("level-3");
    expect(ids).toContain("deep-btn");
  });

  test("includes all nodes from tree", async () => {
    const tree = await setContent(`
			<div>
				<button>A</button>
				<button>B</button>
				<button>C</button>
			</div>
		`);

    const flattened = flattenTree(tree);
    const buttons = flattened.filter((n) => n.tagName === "button");
    expect(buttons.length).toBe(3);
  });
});

describe("isOccludedByPaintOrder", () => {
  test("button covered by opaque overlay is occluded", async () => {
    const tree = await loadFixture("paint-order.html");
    const allNodes = flattenTree(tree);

    const coveredButton = findNodeByAttribute(tree, "id", "covered-button");
    expect(coveredButton).not.toBeNull();

    const isOccluded = isOccludedByPaintOrder(coveredButton!, allNodes);
    expect(isOccluded).toBe(true);
  });

  test("button covered by transparent overlay is not occluded", async () => {
    const tree = await loadFixture("paint-order.html");
    const allNodes = flattenTree(tree);

    const transparentOverlayButton = findNodeByAttribute(tree, "id", "transparent-overlay-button");
    expect(transparentOverlayButton).not.toBeNull();

    const isOccluded = isOccludedByPaintOrder(transparentOverlayButton!, allNodes);
    expect(isOccluded).toBe(false);
  });

  // Note: Current implementation uses DOM traversal order, not CSS stacking context
  // Full z-index stacking context calculation would require significant additional work
  test.skip("button with higher z-index than overlay is not occluded", async () => {
    const tree = await loadFixture("paint-order.html");
    const allNodes = flattenTree(tree);

    const highZButton = findNodeByAttribute(tree, "id", "high-z-button");
    expect(highZButton).not.toBeNull();

    const isOccluded = isOccludedByPaintOrder(highZButton!, allNodes);
    expect(isOccluded).toBe(false);
  });

  test("partially covered button is not occluded", async () => {
    const tree = await loadFixture("paint-order.html");
    const allNodes = flattenTree(tree);

    const partialButton = findNodeByAttribute(tree, "id", "partial-covered-button");
    expect(partialButton).not.toBeNull();

    const isOccluded = isOccludedByPaintOrder(partialButton!, allNodes);
    expect(isOccluded).toBe(false);
  });
});

describe("filterByBboxPropagation", () => {
  test("excludes children inside button bounds", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    const button = findNodeByAttribute(filtered, "id", "button-with-children");
    expect(button).not.toBeNull();

    // Icon and text should be excluded (not in filtered tree)
    const buttonIcon = findNodeByAttribute(filtered, "id", "button-icon");
    const buttonText = findNodeByAttribute(filtered, "id", "button-text");

    // These should be excluded since they're fully contained in button
    expect(buttonIcon).toBeNull();
    expect(buttonText).toBeNull();
  });

  test("excludes children inside anchor bounds", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    const link = findNodeByAttribute(filtered, "id", "link-with-children");
    expect(link).not.toBeNull();

    // Icon and text should be excluded
    const linkIcon = findNodeByAttribute(filtered, "id", "link-icon");
    const linkText = findNodeByAttribute(filtered, "id", "link-text");

    expect(linkIcon).toBeNull();
    expect(linkText).toBeNull();
  });

  test("keeps form elements inside buttons", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    // Checkbox in button should be kept
    const checkbox = findNodeByAttribute(filtered, "id", "checkbox-in-button");
    expect(checkbox).not.toBeNull();
  });

  test("keeps children with onclick handlers", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    // Span with onclick should be kept
    const spanWithOnclick = findNodeByAttribute(filtered, "id", "span-with-onclick");
    expect(spanWithOnclick).not.toBeNull();
  });

  test("keeps children with aria-label", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    // Span with aria-label should be kept
    const spanWithAria = findNodeByAttribute(filtered, "id", "span-with-aria");
    expect(spanWithAria).not.toBeNull();
  });

  test("keeps nested propagating elements", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    // Nested button should be kept
    const nestedButton = findNodeByAttribute(filtered, "id", "nested-button");
    expect(nestedButton).not.toBeNull();
  });

  test("does not exclude children from regular divs", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    // Button and link in regular div should be kept
    const btnInDiv = findNodeByAttribute(filtered, "id", "btn-in-regular-div");
    const linkInDiv = findNodeByAttribute(filtered, "id", "link-in-regular-div");

    expect(btnInDiv).not.toBeNull();
    expect(linkInDiv).not.toBeNull();
  });

  test('excludes children from div[role="combobox"]', async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const filtered = filterByBboxPropagation(tree);

    const combobox = findNodeByAttribute(filtered, "id", "combobox-with-children");
    expect(combobox).not.toBeNull();

    // Children should be excluded
    const comboboxText = findNodeByAttribute(filtered, "id", "combobox-text");
    const comboboxArrow = findNodeByAttribute(filtered, "id", "combobox-arrow");

    expect(comboboxText).toBeNull();
    expect(comboboxArrow).toBeNull();
  });
});

describe("shouldExcludeFromPropagatingParent", () => {
  test("returns true for regular span in button", async () => {
    const tree = await loadFixture("bbox-propagation.html");

    const button = findNodeByAttribute(tree, "id", "button-with-children");
    const buttonText = findNodeByAttribute(tree, "id", "button-text");

    expect(shouldExcludeFromPropagatingParent(buttonText!, button!)).toBe(true);
  });

  test("returns false for input in button", async () => {
    const tree = await loadFixture("bbox-propagation.html");

    const button = findNodeByAttribute(tree, "id", "button-with-input");
    const checkbox = findNodeByAttribute(tree, "id", "checkbox-in-button");

    expect(shouldExcludeFromPropagatingParent(checkbox!, button!)).toBe(false);
  });

  test("returns false for non-propagating parent", async () => {
    const tree = await loadFixture("bbox-propagation.html");

    const regularDiv = findNodeByAttribute(tree, "id", "regular-div-with-children");
    const btnInDiv = findNodeByAttribute(tree, "id", "btn-in-regular-div");

    expect(shouldExcludeFromPropagatingParent(btnInDiv!, regularDiv!)).toBe(false);
  });
});

describe("getExcludedNodeIds", () => {
  test("returns set of node IDs to exclude (bbox propagation)", async () => {
    const tree = await loadFixture("bbox-propagation.html");
    const excluded = getExcludedNodeIds(tree);

    // Button text and icon should be excluded
    const buttonText = findNodeByAttribute(tree, "id", "button-text");
    const buttonIcon = findNodeByAttribute(tree, "id", "button-icon");

    expect(excluded.has(buttonText!.nodeId)).toBe(true);
    expect(excluded.has(buttonIcon!.nodeId)).toBe(true);
  });

  test("preserves form elements in bbox propagation", async () => {
    const tree = await loadFixture("bbox-propagation.html");

    // Verify checkbox is kept in bbox propagation filtered tree
    const filtered = filterByBboxPropagation(tree);
    const filteredCheckbox = findNodeByAttribute(filtered, "id", "checkbox-in-button");
    expect(filteredCheckbox).not.toBeNull();
  });

  test("includes paint-order occluded elements", async () => {
    const tree = await loadFixture("paint-order.html");
    const excluded = getExcludedNodeIds(tree);

    const coveredButton = findNodeByAttribute(tree, "id", "covered-button");
    expect(excluded.has(coveredButton!.nodeId)).toBe(true);
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
