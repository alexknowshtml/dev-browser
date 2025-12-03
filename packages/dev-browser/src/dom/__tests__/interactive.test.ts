import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRawDOM } from "../extract.js";
import {
  isInteractive,
  isPropagatingElement,
  getInteractivityScore,
  countInteractiveDescendants,
  shouldMakeScrollableInteractive,
} from "../interactive.js";
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

describe("isInteractive", () => {
  // Tag-based detection
  test("button elements are interactive", async () => {
    const tree = await setContent(`<button id="btn">Click</button>`);
    const btn = findNodeByAttribute(tree, "id", "btn");
    expect(isInteractive(btn!)).toBe(true);
  });

  test("input elements are interactive", async () => {
    const tree = await setContent(`<input type="text" id="input" />`);
    const input = findNodeByAttribute(tree, "id", "input");
    expect(isInteractive(input!)).toBe(true);
  });

  test("select elements are interactive", async () => {
    const tree = await setContent(`<select id="select"><option>A</option></select>`);
    const select = findNodeByAttribute(tree, "id", "select");
    expect(isInteractive(select!)).toBe(true);
  });

  test("textarea elements are interactive", async () => {
    const tree = await setContent(`<textarea id="textarea"></textarea>`);
    const textarea = findNodeByAttribute(tree, "id", "textarea");
    expect(isInteractive(textarea!)).toBe(true);
  });

  test("anchor elements are interactive", async () => {
    const tree = await setContent(`<a href="#" id="link">Link</a>`);
    const link = findNodeByAttribute(tree, "id", "link");
    expect(isInteractive(link!)).toBe(true);
  });

  test("details/summary elements are interactive", async () => {
    const tree = await setContent(`
			<details id="details">
				<summary id="summary">Summary</summary>
				Content
			</details>
		`);
    const details = findNodeByAttribute(tree, "id", "details");
    const summary = findNodeByAttribute(tree, "id", "summary");
    expect(isInteractive(details!)).toBe(true);
    expect(isInteractive(summary!)).toBe(true);
  });

  // Role-based detection
  test('role="button" elements are interactive', async () => {
    const tree = await setContent(`<div role="button" id="role-btn">Button</div>`);
    const roleBtn = findNodeByAttribute(tree, "id", "role-btn");
    expect(isInteractive(roleBtn!)).toBe(true);
  });

  test('role="link" elements are interactive', async () => {
    const tree = await setContent(`<div role="link" id="role-link">Link</div>`);
    const roleLink = findNodeByAttribute(tree, "id", "role-link");
    expect(isInteractive(roleLink!)).toBe(true);
  });

  test('role="textbox" elements are interactive', async () => {
    const tree = await setContent(
      `<div role="textbox" id="role-textbox" contenteditable="true">Text</div>`
    );
    const roleTextbox = findNodeByAttribute(tree, "id", "role-textbox");
    expect(isInteractive(roleTextbox!)).toBe(true);
  });

  test('role="checkbox" elements are interactive', async () => {
    const tree = await setContent(
      `<div role="checkbox" id="role-checkbox" aria-checked="false">Check</div>`
    );
    const roleCheckbox = findNodeByAttribute(tree, "id", "role-checkbox");
    expect(isInteractive(roleCheckbox!)).toBe(true);
  });

  test('role="combobox" elements are interactive', async () => {
    const tree = await setContent(`<div role="combobox" id="role-combobox">Combo</div>`);
    const roleCombobox = findNodeByAttribute(tree, "id", "role-combobox");
    expect(isInteractive(roleCombobox!)).toBe(true);
  });

  test('role="slider" elements are interactive', async () => {
    const tree = await setContent(
      `<div role="slider" id="role-slider" aria-valuenow="50">Slider</div>`
    );
    const roleSlider = findNodeByAttribute(tree, "id", "role-slider");
    expect(isInteractive(roleSlider!)).toBe(true);
  });

  // Attribute-based detection
  test("onclick attribute makes element interactive", async () => {
    const tree = await setContent(`<div id="onclick-div" onclick="alert()">Click me</div>`);
    const onclickDiv = findNodeByAttribute(tree, "id", "onclick-div");
    expect(isInteractive(onclickDiv!)).toBe(true);
  });

  test("tabindex >= 0 makes element interactive", async () => {
    const tree = await setContent(`
			<div id="tabindex-zero" tabindex="0">Tab 0</div>
			<div id="tabindex-positive" tabindex="1">Tab 1</div>
		`);
    const tabindexZero = findNodeByAttribute(tree, "id", "tabindex-zero");
    const tabindexPositive = findNodeByAttribute(tree, "id", "tabindex-positive");
    expect(isInteractive(tabindexZero!)).toBe(true);
    expect(isInteractive(tabindexPositive!)).toBe(true);
  });

  test("tabindex -1 does not make element interactive", async () => {
    const tree = await setContent(`<div id="tabindex-negative" tabindex="-1">Tab -1</div>`);
    const tabindexNegative = findNodeByAttribute(tree, "id", "tabindex-negative");
    expect(isInteractive(tabindexNegative!)).toBe(false);
  });

  test("cursor:pointer makes element interactive", async () => {
    const tree = await setContent(`<div id="pointer-div" style="cursor: pointer;">Clickable</div>`);
    const pointerDiv = findNodeByAttribute(tree, "id", "pointer-div");
    expect(isInteractive(pointerDiv!)).toBe(true);
  });

  test("contenteditable makes element interactive", async () => {
    const tree = await setContent(`<div id="editable" contenteditable="true">Edit me</div>`);
    const editable = findNodeByAttribute(tree, "id", "editable");
    expect(isInteractive(editable!)).toBe(true);
  });

  // Edge cases
  test("disabled elements are still detected as interactive", async () => {
    const tree = await setContent(`<button id="disabled-btn" disabled>Disabled</button>`);
    const disabledBtn = findNodeByAttribute(tree, "id", "disabled-btn");
    expect(isInteractive(disabledBtn!)).toBe(true);
  });

  test("hidden inputs are not interactive", async () => {
    const tree = await setContent(`<input type="hidden" id="hidden-input" value="secret" />`);
    const hiddenInput = findNodeByAttribute(tree, "id", "hidden-input");
    expect(isInteractive(hiddenInput!)).toBe(false);
  });

  test("large iframes are interactive", async () => {
    const tree = await setContent(
      `<iframe id="large-iframe" src="about:blank" width="200" height="200"></iframe>`
    );
    const largeIframe = findNodeByAttribute(tree, "id", "large-iframe");
    expect(isInteractive(largeIframe!)).toBe(true);
  });

  test("small iframes are not interactive", async () => {
    const tree = await setContent(
      `<iframe id="small-iframe" src="about:blank" width="50" height="50"></iframe>`
    );
    const smallIframe = findNodeByAttribute(tree, "id", "small-iframe");
    expect(isInteractive(smallIframe!)).toBe(false);
  });

  // Non-interactive elements
  test("plain div is not interactive", async () => {
    const tree = await setContent(`<div id="plain-div">Just text</div>`);
    const plainDiv = findNodeByAttribute(tree, "id", "plain-div");
    expect(isInteractive(plainDiv!)).toBe(false);
  });

  test("plain span is not interactive", async () => {
    const tree = await setContent(`<span id="plain-span">Just text</span>`);
    const plainSpan = findNodeByAttribute(tree, "id", "plain-span");
    expect(isInteractive(plainSpan!)).toBe(false);
  });

  test("handles interactive fixture correctly", async () => {
    const tree = await loadFixture("interactive.html");

    // Standard tags
    expect(isInteractive(findNodeByAttribute(tree, "id", "standard-button")!)).toBe(true);
    expect(isInteractive(findNodeByAttribute(tree, "id", "text-input")!)).toBe(true);
    expect(isInteractive(findNodeByAttribute(tree, "id", "anchor-element")!)).toBe(true);

    // ARIA roles
    expect(isInteractive(findNodeByAttribute(tree, "id", "role-button")!)).toBe(true);
    expect(isInteractive(findNodeByAttribute(tree, "id", "role-link")!)).toBe(true);

    // Attribute-based
    expect(isInteractive(findNodeByAttribute(tree, "id", "onclick-div")!)).toBe(true);
    expect(isInteractive(findNodeByAttribute(tree, "id", "tabindex-zero")!)).toBe(true);
    expect(isInteractive(findNodeByAttribute(tree, "id", "tabindex-negative")!)).toBe(false);

    // Non-interactive
    expect(isInteractive(findNodeByAttribute(tree, "id", "plain-div")!)).toBe(false);
    expect(isInteractive(findNodeByAttribute(tree, "id", "plain-span")!)).toBe(false);
  });
});

describe("isPropagatingElement", () => {
  test("button is propagating", async () => {
    const tree = await setContent(`<button id="btn">Click</button>`);
    const btn = findNodeByAttribute(tree, "id", "btn");
    expect(isPropagatingElement(btn!)).toBe(true);
  });

  test("anchor is propagating", async () => {
    const tree = await setContent(`<a href="#" id="link">Link</a>`);
    const link = findNodeByAttribute(tree, "id", "link");
    expect(isPropagatingElement(link!)).toBe(true);
  });

  test("div with role=button is propagating", async () => {
    const tree = await setContent(`<div role="button" id="role-btn">Button</div>`);
    const roleBtn = findNodeByAttribute(tree, "id", "role-btn");
    expect(isPropagatingElement(roleBtn!)).toBe(true);
  });

  test("plain div is not propagating", async () => {
    const tree = await setContent(`<div id="plain-div">Text</div>`);
    const plainDiv = findNodeByAttribute(tree, "id", "plain-div");
    expect(isPropagatingElement(plainDiv!)).toBe(false);
  });
});

describe("getInteractivityScore", () => {
  test("button has highest score", async () => {
    const tree = await setContent(`
			<button id="btn">Button</button>
			<a href="#" id="link">Link</a>
			<div role="button" id="role-btn">Role Button</div>
			<div id="plain" style="cursor: pointer;">Plain clickable</div>
		`);
    const btn = findNodeByAttribute(tree, "id", "btn");
    const link = findNodeByAttribute(tree, "id", "link");
    const roleBtn = findNodeByAttribute(tree, "id", "role-btn");
    const plain = findNodeByAttribute(tree, "id", "plain");

    const btnScore = getInteractivityScore(btn!);
    const linkScore = getInteractivityScore(link!);
    const roleBtnScore = getInteractivityScore(roleBtn!);
    const plainScore = getInteractivityScore(plain!);

    // Button has highest score
    expect(btnScore).toBeGreaterThanOrEqual(linkScore);
    expect(btnScore).toBeGreaterThan(roleBtnScore);
    expect(roleBtnScore).toBeGreaterThan(plainScore);
  });
});

describe("countInteractiveDescendants", () => {
  test("counts interactive children", async () => {
    const tree = await setContent(`
			<div id="parent">
				<button>Button 1</button>
				<button>Button 2</button>
				<span>Not interactive</span>
			</div>
		`);
    const parent = findNodeByAttribute(tree, "id", "parent");
    expect(countInteractiveDescendants(parent!)).toBe(2);
  });

  test("counts nested interactive descendants", async () => {
    const tree = await setContent(`
			<div id="parent">
				<div>
					<button>Button 1</button>
					<a href="#">Link</a>
				</div>
				<input type="text" />
			</div>
		`);
    const parent = findNodeByAttribute(tree, "id", "parent");
    expect(countInteractiveDescendants(parent!)).toBe(3);
  });

  test("returns 0 for no interactive descendants", async () => {
    const tree = await setContent(`
			<div id="parent">
				<span>Text</span>
				<p>Paragraph</p>
			</div>
		`);
    const parent = findNodeByAttribute(tree, "id", "parent");
    expect(countInteractiveDescendants(parent!)).toBe(0);
  });
});

describe("shouldMakeScrollableInteractive", () => {
  test("scrollable with no interactive descendants should be interactive", async () => {
    const tree = await setContent(`
			<div id="scrollable" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">
					<p>Just text content</p>
					<span>More text</span>
				</div>
			</div>
		`);
    const scrollable = findNodeByAttribute(tree, "id", "scrollable");
    expect(shouldMakeScrollableInteractive(scrollable!)).toBe(true);
  });

  test("scrollable with interactive descendants should not be made interactive", async () => {
    const tree = await setContent(`
			<div id="scrollable" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">
					<button>Button in scroll</button>
				</div>
			</div>
		`);
    const scrollable = findNodeByAttribute(tree, "id", "scrollable");
    expect(shouldMakeScrollableInteractive(scrollable!)).toBe(false);
  });

  test("non-scrollable element should not be made interactive", async () => {
    const tree = await setContent(`
			<div id="not-scrollable" style="width: 200px; height: 100px; overflow: hidden;">
				<p>Just text</p>
			</div>
		`);
    const notScrollable = findNodeByAttribute(tree, "id", "not-scrollable");
    expect(shouldMakeScrollableInteractive(notScrollable!)).toBe(false);
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
