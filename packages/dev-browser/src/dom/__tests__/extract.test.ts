import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRawDOM } from "../extract.js";
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

describe("extractRawDOM", () => {
  test("extracts basic element tree structure", async () => {
    const tree = await setContent(`
			<div id="parent">
				<button id="child-btn">Click me</button>
				<span id="child-span">Text</span>
			</div>
		`);

    expect(tree).not.toBeNull();
    expect(tree.tagName).toBe("body");
    expect(tree.children.length).toBeGreaterThan(0);

    // Find the parent div
    const parentDiv = tree.children.find(
      (c) => c.tagName === "div" && c.attributes.id === "parent"
    );
    expect(parentDiv).toBeDefined();
    expect(parentDiv?.children.length).toBe(2);
  });

  test("captures all HTML attributes", async () => {
    const tree = await setContent(`
			<input
				type="text"
				id="test-input"
				name="username"
				placeholder="Enter name"
				required
				aria-label="Username field"
				data-testid="username-input"
			/>
		`);

    const input = findNodeByAttribute(tree, "id", "test-input");

    expect(input).not.toBeNull();
    expect(input?.attributes.type).toBe("text");
    expect(input?.attributes.name).toBe("username");
    expect(input?.attributes.placeholder).toBe("Enter name");
    expect(input?.attributes.required).toBe("");
    expect(input?.attributes["aria-label"]).toBe("Username field");
    expect(input?.attributes["data-testid"]).toBe("username-input");
  });

  test("computes bounding rectangles correctly", async () => {
    const tree = await setContent(`
			<div id="test-box" style="position: absolute; top: 100px; left: 50px; width: 200px; height: 150px;">
				Content
			</div>
		`);

    const box = findNodeByAttribute(tree, "id", "test-box");

    expect(box).not.toBeNull();
    expect(box?.boundingRect.x).toBeCloseTo(50, 0);
    expect(box?.boundingRect.y).toBeCloseTo(100, 0);
    expect(box?.boundingRect.width).toBeCloseTo(200, 0);
    expect(box?.boundingRect.height).toBeCloseTo(150, 0);
  });

  test("detects scrollable containers", async () => {
    const tree = await setContent(`
			<div id="scrollable" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">Tall content</div>
			</div>
			<div id="not-scrollable" style="width: 200px; height: 100px; overflow: hidden;">
				<div style="height: 500px;">Tall content</div>
			</div>
		`);

    const scrollable = findNodeByAttribute(tree, "id", "scrollable");
    const notScrollable = findNodeByAttribute(tree, "id", "not-scrollable");

    expect(scrollable?.isScrollable).toBe(true);
    expect(notScrollable?.isScrollable).toBe(false);
  });

  test("traverses shadow DOM roots", async () => {
    await page.setContent(`
			<div id="shadow-host"></div>
			<script>
				const host = document.getElementById('shadow-host');
				const shadow = host.attachShadow({ mode: 'open' });
				shadow.innerHTML = '<button id="shadow-btn">Shadow Button</button>';
			</script>
		`);

    // Wait for script execution
    await page.waitForFunction(() => {
      const host = document.getElementById("shadow-host");
      return host?.shadowRoot?.querySelector("button");
    });

    const tree = await extractRawDOM(page);
    const host = findNodeByAttribute(tree!, "id", "shadow-host");

    expect(host).not.toBeNull();
    expect(host?.shadowRoots.length).toBe(1);

    const shadowRoot = host?.shadowRoots[0];
    expect(shadowRoot?.tagName).toBe("#shadow-root");
    expect(shadowRoot?.shadowMode).toBe("open");

    // Find button in shadow root
    const shadowBtn = shadowRoot?.children.find(
      (c) => c.tagName === "button" && c.attributes.id === "shadow-btn"
    );
    expect(shadowBtn).toBeDefined();
  });

  test("handles deeply nested structures", async () => {
    const tree = await setContent(`
			<div id="level-1">
				<div id="level-2">
					<div id="level-3">
						<div id="level-4">
							<div id="level-5">
								<button id="deep-btn">Deep Button</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		`);

    const deepBtn = findNodeByAttribute(tree, "id", "deep-btn");

    expect(deepBtn).not.toBeNull();
    expect(deepBtn?.tagName).toBe("button");
  });

  test("captures computed styles", async () => {
    const tree = await setContent(`
			<div id="styled" style="display: flex; visibility: visible; opacity: 0.5; cursor: pointer;">
				Content
			</div>
		`);

    const styled = findNodeByAttribute(tree, "id", "styled");

    expect(styled?.computedStyles.display).toBe("flex");
    expect(styled?.computedStyles.visibility).toBe("visible");
    expect(styled?.computedStyles.opacity).toBe("0.5");
    expect(styled?.computedStyles.cursor).toBe("pointer");
  });

  test("assigns paint order correctly", async () => {
    const tree = await setContent(`
			<div id="first">First</div>
			<div id="second">Second</div>
			<div id="third">Third</div>
		`);

    const first = findNodeByAttribute(tree, "id", "first");
    const second = findNodeByAttribute(tree, "id", "second");
    const third = findNodeByAttribute(tree, "id", "third");

    // Paint order should increase as we traverse DOM
    expect(first?.paintOrder).toBeLessThan(second?.paintOrder || 0);
    expect(second?.paintOrder).toBeLessThan(third?.paintOrder || 0);
  });

  test("excludes script and style tags", async () => {
    const tree = await setContent(`
			<div id="content">
				<script>console.log('script');</script>
				<style>.test { color: red; }</style>
				<button id="visible-btn">Button</button>
			</div>
		`);

    const content = findNodeByAttribute(tree, "id", "content");

    // Should only contain the button, not script or style
    const scriptTag = findNodeByTagName(content!, "script");
    const styleTag = findNodeByTagName(content!, "style");
    const button = findNodeByAttribute(content!, "id", "visible-btn");

    expect(scriptTag).toBeNull();
    expect(styleTag).toBeNull();
    expect(button).not.toBeNull();
  });

  test("extracts text content from text nodes", async () => {
    const tree = await setContent(`
			<div id="parent">
				<span id="with-text">Hello World</span>
				<span id="empty"></span>
			</div>
		`);

    const withText = findNodeByAttribute(tree, "id", "with-text");
    const empty = findNodeByAttribute(tree, "id", "empty");

    expect(withText?.textContent).toBe("Hello World");
    // Empty span should have no text content
    expect(empty?.textContent).toBe("");
  });

  test("extracts iframe content documents", async () => {
    const tree = await loadFixture("iframes.html");

    // Wait for iframes to load
    await page.waitForTimeout(500);

    // Find srcdoc iframe
    const srcdocIframe = findNodeByAttribute(tree, "id", "srcdoc-iframe");
    expect(srcdocIframe).not.toBeNull();
    expect(srcdocIframe?.isFrame).toBe(true);
  });

  test("captures scroll position and dimensions", async () => {
    await page.setContent(`
			<div id="scroll-container" style="width: 200px; height: 100px; overflow: auto;">
				<div style="height: 500px;">Tall content</div>
			</div>
		`);

    // Scroll the container
    await page.evaluate(() => {
      const container = document.getElementById("scroll-container");
      if (container) container.scrollTop = 100;
    });

    const tree = await extractRawDOM(page);
    const container = findNodeByAttribute(tree!, "id", "scroll-container");

    expect(container?.scrollTop).toBe(100);
    expect(container?.scrollHeight).toBe(500);
    expect(container?.clientHeight).toBe(100);
  });

  test("includes viewport dimensions on root node", async () => {
    const tree = await setContent("<div>Content</div>");

    expect(tree.viewportWidth).toBeGreaterThan(0);
    expect(tree.viewportHeight).toBeGreaterThan(0);
  });

  test("handles page with fixture", async () => {
    const tree = await loadFixture("basic.html");

    expect(tree).not.toBeNull();

    // Find specific elements from the fixture
    const submitBtn = findNodeByAttribute(tree, "id", "submit-btn");
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.tagName).toBe("button");

    const usernameInput = findNodeByAttribute(tree, "id", "username");
    expect(usernameInput).not.toBeNull();
    expect(usernameInput?.attributes.type).toBe("text");
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
  if (node.tagName === tagName) {
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
