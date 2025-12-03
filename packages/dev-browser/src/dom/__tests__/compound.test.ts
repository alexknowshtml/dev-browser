import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { extractRawDOM } from "../extract.js";
import {
  getCompoundComponents,
  formatCompoundAnnotation,
  hasCompoundComponents,
} from "../compound.js";
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

describe("getCompoundComponents - select", () => {
  test("adds Dropdown Toggle component", async () => {
    const tree = await setContent(`
			<select id="test-select">
				<option value="a">Option A</option>
				<option value="b">Option B</option>
			</select>
		`);

    const select = findNodeByAttribute(tree, "id", "test-select");
    const compounds = getCompoundComponents(select!);

    expect(compounds.length).toBe(1);
    expect(compounds[0].name).toBe("Dropdown Toggle");
    expect(compounds[0].role).toBe("combobox");
  });

  test("shows first 4 options + count", async () => {
    const tree = await loadFixture("compound.html");
    const select = findNodeByAttribute(tree, "id", "many-options-select");
    const compounds = getCompoundComponents(select!);

    expect(compounds[0].options!.length).toBe(5); // 4 + "... +N more"
    expect(compounds[0].options![4]).toContain("+6 more");
  });

  test("shows current selected option", async () => {
    const tree = await setContent(`
			<select id="test-select">
				<option value="a">Option A</option>
				<option value="b" selected>Option B</option>
			</select>
		`);

    const select = findNodeByAttribute(tree, "id", "test-select");
    const compounds = getCompoundComponents(select!);

    expect(compounds[0].current).toBe("Option B");
  });

  test("defaults to first option when none selected", async () => {
    const tree = await setContent(`
			<select id="test-select">
				<option value="a">First Option</option>
				<option value="b">Second Option</option>
			</select>
		`);

    const select = findNodeByAttribute(tree, "id", "test-select");
    const compounds = getCompoundComponents(select!);

    expect(compounds[0].current).toBe("First Option");
  });

  test("handles empty select", async () => {
    const tree = await loadFixture("compound.html");
    const select = findNodeByAttribute(tree, "id", "empty-select");
    const compounds = getCompoundComponents(select!);

    expect(compounds[0].options!.length).toBe(0);
    expect(compounds[0].current).toBeUndefined();
  });
});

describe("getCompoundComponents - file input", () => {
  test("adds Browse Files and File Selected components", async () => {
    const tree = await setContent(`<input type="file" id="file-input" />`);

    const input = findNodeByAttribute(tree, "id", "file-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds.length).toBe(2);
    expect(compounds[0].name).toBe("Browse Files");
    expect(compounds[0].role).toBe("button");
    expect(compounds[1].name).toBe("File Selected");
    expect(compounds[1].role).toBe("textbox");
  });

  test("shows accept types in format", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "file-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[1].format).toContain(".pdf");
  });

  test("handles multiple file input", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "multi-file-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[1].name).toBe("Files Selected");
  });
});

describe("getCompoundComponents - range input", () => {
  test("adds Slider component with min/max", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "volume-slider");
    const compounds = getCompoundComponents(input!);

    expect(compounds.length).toBe(1);
    expect(compounds[0].name).toBe("Slider");
    expect(compounds[0].role).toBe("slider");
    expect(compounds[0].min).toBe(0);
    expect(compounds[0].max).toBe(100);
    expect(compounds[0].current).toBe("50");
  });

  test("includes step in format when specified", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "rating-slider");
    const compounds = getCompoundComponents(input!);

    expect(compounds[0].format).toContain("Step: 1");
  });
});

describe("getCompoundComponents - number input", () => {
  test("adds Decrement, Value, Increment components", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "quantity-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds.length).toBe(3);
    expect(compounds[0].name).toBe("Decrement");
    expect(compounds[1].name).toBe("Value");
    expect(compounds[2].name).toBe("Increment");
  });

  test("includes min/max on Value component", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "quantity-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[1].min).toBe(1);
    expect(compounds[1].max).toBe(99);
    expect(compounds[1].current).toBe("1");
  });

  test("handles unbounded number input", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "unbounded-number");
    const compounds = getCompoundComponents(input!);

    expect(compounds[1].min).toBeUndefined();
    expect(compounds[1].max).toBeUndefined();
  });
});

describe("getCompoundComponents - date/time inputs", () => {
  test("date input shows format", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "date-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[0].name).toBe("Date Picker");
    expect(compounds[0].format).toBe("YYYY-MM-DD");
  });

  test("time input shows format", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "time-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[0].format).toBe("HH:MM");
  });

  test("datetime-local input shows format", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "datetime-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[0].format).toBe("YYYY-MM-DDTHH:MM");
  });
});

describe("getCompoundComponents - color input", () => {
  test("shows Color Picker component", async () => {
    const tree = await loadFixture("compound.html");
    const input = findNodeByAttribute(tree, "id", "color-input");
    const compounds = getCompoundComponents(input!);

    expect(compounds[0].name).toBe("Color Picker");
    expect(compounds[0].current).toBe("#ff0000");
    expect(compounds[0].format).toBe("Hex color");
  });
});

describe("getCompoundComponents - video", () => {
  test("adds media control components when controls present", async () => {
    const tree = await loadFixture("compound.html");
    const video = findNodeByAttribute(tree, "id", "test-video");
    const compounds = getCompoundComponents(video!);

    expect(compounds.length).toBe(5);
    expect(compounds.map((c) => c.name)).toContain("Play/Pause");
    expect(compounds.map((c) => c.name)).toContain("Progress");
    expect(compounds.map((c) => c.name)).toContain("Volume");
    expect(compounds.map((c) => c.name)).toContain("Mute");
    expect(compounds.map((c) => c.name)).toContain("Fullscreen");
  });

  test("returns empty for video without controls", async () => {
    const tree = await setContent(`<video id="no-controls" src="about:blank"></video>`);
    const video = findNodeByAttribute(tree, "id", "no-controls");
    const compounds = getCompoundComponents(video!);

    expect(compounds.length).toBe(0);
  });
});

describe("getCompoundComponents - audio", () => {
  test("adds media control components", async () => {
    const tree = await loadFixture("compound.html");
    const audio = findNodeByAttribute(tree, "id", "test-audio");
    const compounds = getCompoundComponents(audio!);

    expect(compounds.length).toBe(4);
    expect(compounds.map((c) => c.name)).toContain("Play/Pause");
    expect(compounds.map((c) => c.name)).toContain("Progress");
    expect(compounds.map((c) => c.name)).toContain("Volume");
    expect(compounds.map((c) => c.name)).toContain("Mute");
    // Audio doesn't have Fullscreen
    expect(compounds.map((c) => c.name)).not.toContain("Fullscreen");
  });
});

describe("getCompoundComponents - details", () => {
  test("adds Toggle component", async () => {
    const tree = await loadFixture("compound.html");
    const details = findNodeByAttribute(tree, "id", "test-details");
    const compounds = getCompoundComponents(details!);

    expect(compounds.length).toBe(1);
    expect(compounds[0].name).toBe("Toggle");
    expect(compounds[0].role).toBe("button");
    expect(compounds[0].current).toBe("collapsed");
  });

  test("shows expanded state", async () => {
    const tree = await setContent(
      `<details id="open-details" open><summary>Title</summary></details>`
    );
    const details = findNodeByAttribute(tree, "id", "open-details");
    const compounds = getCompoundComponents(details!);

    expect(compounds[0].current).toBe("expanded");
  });
});

describe("formatCompoundAnnotation", () => {
  test("formats basic component", () => {
    const annotation = formatCompoundAnnotation([{ name: "Button", role: "button" }]);
    expect(annotation).toBe("{Button (button)}");
  });

  test("formats component with min/max", () => {
    const annotation = formatCompoundAnnotation([
      { name: "Slider", role: "slider", min: 0, max: 100 },
    ]);
    expect(annotation).toContain("[0-100]");
  });

  test("formats component with current value", () => {
    const annotation = formatCompoundAnnotation([
      { name: "Value", role: "spinbutton", current: "50" },
    ]);
    expect(annotation).toContain(": 50");
  });

  test("formats multiple components", () => {
    const annotation = formatCompoundAnnotation([
      { name: "Decrement", role: "button" },
      { name: "Value", role: "spinbutton" },
      { name: "Increment", role: "button" },
    ]);
    expect(annotation).toContain(" | ");
    expect(annotation.split("|").length).toBe(3);
  });

  test("returns empty string for no components", () => {
    const annotation = formatCompoundAnnotation([]);
    expect(annotation).toBe("");
  });
});

describe("hasCompoundComponents", () => {
  test("returns true for select", async () => {
    const tree = await setContent(`<select id="s"></select>`);
    const select = findNodeByAttribute(tree, "id", "s");
    expect(hasCompoundComponents(select!)).toBe(true);
  });

  test("returns true for file input", async () => {
    const tree = await setContent(`<input type="file" id="f" />`);
    const input = findNodeByAttribute(tree, "id", "f");
    expect(hasCompoundComponents(input!)).toBe(true);
  });

  test("returns true for range input", async () => {
    const tree = await setContent(`<input type="range" id="r" />`);
    const input = findNodeByAttribute(tree, "id", "r");
    expect(hasCompoundComponents(input!)).toBe(true);
  });

  test("returns true for video with controls", async () => {
    const tree = await setContent(`<video id="v" controls></video>`);
    const video = findNodeByAttribute(tree, "id", "v");
    expect(hasCompoundComponents(video!)).toBe(true);
  });

  test("returns false for regular button", async () => {
    const tree = await setContent(`<button id="b">Click</button>`);
    const button = findNodeByAttribute(tree, "id", "b");
    expect(hasCompoundComponents(button!)).toBe(false);
  });

  test("returns false for text input", async () => {
    const tree = await setContent(`<input type="text" id="t" />`);
    const input = findNodeByAttribute(tree, "id", "t");
    expect(hasCompoundComponents(input!)).toBe(false);
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
