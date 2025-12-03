/**
 * DOM tree extraction via Playwright page.evaluate()
 * Injects JavaScript to walk the DOM and collect all necessary data
 */

import type { Page, Frame } from "playwright";
import type { RawDOMNode, ComputedStyles, BoundingRect } from "./types.js";
import { EXCLUDED_TAGS } from "./types.js";

/**
 * Extract the raw DOM tree from a Playwright page
 */
export async function extractRawDOM(page: Page): Promise<RawDOMNode | null> {
  const result = await page.evaluate(extractDOMScript);

  // Process iframes recursively
  if (result) {
    await processFrames(page, result);
  }

  return result;
}

/**
 * Process iframe content documents recursively
 */
async function processFrames(pageOrFrame: Page | Frame, node: RawDOMNode): Promise<void> {
  // Process children first
  for (const child of node.children) {
    await processFrames(pageOrFrame, child);
  }

  // Process shadow roots
  for (const shadow of node.shadowRoots) {
    await processFrames(pageOrFrame, shadow);
  }

  // If this is an iframe, try to extract its content
  if (node.isFrame && node.frameUrl && node.frameUrl !== "about:blank") {
    try {
      // Find the frame by URL or try to locate it
      const frames =
        "frames" in pageOrFrame ? pageOrFrame.frames() : (pageOrFrame as Page).frames();
      const frame = frames.find((f) => {
        try {
          return f.url() === node.frameUrl || f.url().includes(node.frameUrl || "");
        } catch {
          return false;
        }
      });

      if (frame) {
        try {
          const frameContent = await frame.evaluate(extractDOMScript);
          if (frameContent) {
            node.contentDocument = frameContent;
            // Recursively process the frame's content
            await processFrames(frame, frameContent);
          }
        } catch {
          // Frame may be cross-origin or detached
        }
      }
    } catch {
      // Ignore frame processing errors
    }
  }
}

/**
 * JavaScript function injected into the page to extract DOM tree
 * This runs in the browser context
 */
function extractDOMScript(): RawDOMNode | null {
  let nodeIdCounter = 0;
  let paintOrderCounter = 0;

  const EXCLUDED_TAGS_SET = new Set([
    "script",
    "style",
    "noscript",
    "meta",
    "link",
    "head",
    "title",
  ]);

  function getComputedStyles(element: Element): ComputedStyles {
    const styles = window.getComputedStyle(element);
    return {
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      cursor: styles.cursor,
      backgroundColor: styles.backgroundColor,
      overflow: styles.overflow,
      overflowX: styles.overflowX,
      overflowY: styles.overflowY,
      pointerEvents: styles.pointerEvents,
    };
  }

  function getBoundingRect(element: Element): BoundingRect {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }

  function getAttributes(element: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const attr of element.attributes) {
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  function isScrollable(element: Element): boolean {
    const styles = window.getComputedStyle(element);
    const overflowY = styles.overflowY;
    const overflowX = styles.overflowX;

    const canScrollY =
      (overflowY === "auto" || overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight;

    const canScrollX =
      (overflowX === "auto" || overflowX === "scroll") && element.scrollWidth > element.clientWidth;

    return canScrollY || canScrollX;
  }

  function getTextContent(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").trim();
    }

    // For elements, get only direct text (not from children)
    let text = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += (child.textContent || "").trim() + " ";
      }
    }
    return text.trim();
  }

  function extractNode(node: Node, depth: number = 0): RawDOMNode | null {
    // Handle text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").trim();
      if (!text || text.length <= 1) {
        return null;
      }

      // Get parent's bounding rect for text node positioning
      const parentElement = node.parentElement;
      const rect = parentElement
        ? getBoundingRect(parentElement)
        : { x: 0, y: 0, width: 0, height: 0 };

      return {
        nodeId: nodeIdCounter++,
        nodeType: "TEXT_NODE",
        tagName: "#text",
        attributes: {},
        textContent: text,
        boundingRect: rect,
        computedStyles: {
          display: "inline",
          visibility: "visible",
          opacity: "1",
          cursor: "auto",
          backgroundColor: "transparent",
          overflow: "visible",
          overflowX: "visible",
          overflowY: "visible",
          pointerEvents: "auto",
        },
        isScrollable: false,
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 0,
        scrollWidth: 0,
        clientHeight: 0,
        clientWidth: 0,
        paintOrder: paintOrderCounter++,
        children: [],
        shadowRoots: [],
        contentDocument: null,
        isFrame: false,
      };
    }

    // Handle element nodes
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();

    // Skip excluded tags
    if (EXCLUDED_TAGS_SET.has(tagName)) {
      return null;
    }

    const isFrame = tagName === "iframe" || tagName === "frame";
    const attributes = getAttributes(element);
    const computedStyles = getComputedStyles(element);
    const boundingRect = getBoundingRect(element);

    // Extract children
    const children: RawDOMNode[] = [];
    for (const child of element.childNodes) {
      const extractedChild = extractNode(child, depth + 1);
      if (extractedChild) {
        children.push(extractedChild);
      }
    }

    // Extract shadow roots
    const shadowRoots: RawDOMNode[] = [];
    if (element.shadowRoot) {
      const shadowNode = extractShadowRoot(element.shadowRoot, "open", depth);
      if (shadowNode) {
        shadowRoots.push(shadowNode);
      }
    }

    // Check for closed shadow root (can't access directly, but we mark the host)
    // Note: We can't actually extract closed shadow roots, but we mark their presence
    const shadowMode = element.shadowRoot ? "open" : undefined;

    const rawNode: RawDOMNode = {
      nodeId: nodeIdCounter++,
      nodeType: "ELEMENT_NODE",
      tagName,
      attributes,
      textContent: getTextContent(element),
      boundingRect,
      computedStyles,
      isScrollable: isScrollable(element),
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      paintOrder: paintOrderCounter++,
      children,
      shadowRoots,
      shadowMode,
      contentDocument: null, // Will be filled in by processFrames
      isFrame,
      frameUrl: isFrame ? (element as HTMLIFrameElement).src : undefined,
    };

    // Add viewport dimensions to root
    if (depth === 0) {
      rawNode.viewportWidth = window.innerWidth;
      rawNode.viewportHeight = window.innerHeight;
    }

    return rawNode;
  }

  function extractShadowRoot(
    shadowRoot: ShadowRoot,
    mode: "open" | "closed",
    depth: number
  ): RawDOMNode | null {
    const children: RawDOMNode[] = [];
    for (const child of shadowRoot.childNodes) {
      const extractedChild = extractNode(child, depth + 1);
      if (extractedChild) {
        children.push(extractedChild);
      }
    }

    if (children.length === 0) {
      return null;
    }

    return {
      nodeId: nodeIdCounter++,
      nodeType: "DOCUMENT_FRAGMENT_NODE",
      tagName: "#shadow-root",
      attributes: {},
      textContent: "",
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
      computedStyles: {
        display: "contents",
        visibility: "visible",
        opacity: "1",
        cursor: "auto",
        backgroundColor: "transparent",
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        pointerEvents: "auto",
      },
      isScrollable: false,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      clientHeight: 0,
      clientWidth: 0,
      paintOrder: paintOrderCounter++,
      children,
      shadowRoots: [],
      shadowMode: mode,
      contentDocument: null,
      isFrame: false,
    };
  }

  // Start extraction from document.body or documentElement
  const root = document.body || document.documentElement;
  if (!root) {
    return null;
  }

  return extractNode(root);
}
