/**
 * Tree serialization for LLM output
 * Converts processed DOM tree to browser-use format string
 *
 * Key design: Only output "meaningful" nodes - interactive elements, scrollable containers,
 * shadow DOM, and iframes. Structural wrappers (table, tr, td, div, span) are traversed
 * but not output, resulting in a flat, LLM-friendly format.
 */

import type { RawDOMNode, LLMTreeResult, GetLLMTreeOptions, ProcessedNode } from "./types.js";
import { DEFAULT_INCLUDE_ATTRIBUTES } from "./types.js";
import { isInteractive } from "./interactive.js";
import { isVisible } from "./visibility.js";

/**
 * Tags that are purely structural and should not be output
 * Their children are still traversed
 */
const STRUCTURAL_TAGS = new Set([
  "div",
  "span",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "tr",
  "td",
  "th",
  "colgroup",
  "col",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "center",
  "p",
  "br",
  "hr",
  "form",
  "fieldset",
  "legend",
]);

/**
 * Context for serialization - tracks state across recursive calls
 */
interface SerializationContext {
  index: number;
  selectorMap: Map<number, string>;
  previousState?: Map<number, boolean>;
  maxTextLength: number;
  includeAttributes: string[];
}

/**
 * Build a CSS selector for a node
 * Prefers: id > data-testid > unique attributes > nth-child path
 */
export function buildSelector(node: RawDOMNode, ancestors: RawDOMNode[] = []): string {
  const tagName = node.tagName.toLowerCase();

  // Skip pseudo-elements and text nodes
  if (tagName.startsWith("#") || node.nodeType === "TEXT_NODE") {
    return "";
  }

  // Prefer ID selector
  if (node.attributes.id) {
    return `#${escapeSelector(node.attributes.id)}`;
  }

  // Use data-testid if available
  if (node.attributes["data-testid"]) {
    return `[data-testid="${escapeSelector(node.attributes["data-testid"])}"]`;
  }

  // Use name attribute for form elements
  if (node.attributes.name && ["input", "select", "textarea"].includes(tagName)) {
    return `${tagName}[name="${escapeSelector(node.attributes.name)}"]`;
  }

  // Build path using nth-child from root
  const pathParts: string[] = [];
  const path = [...ancestors, node];

  for (let i = 0; i < path.length; i++) {
    const current = path[i]!;
    const currentTag = current.tagName.toLowerCase();

    if (currentTag.startsWith("#") || current.nodeType === "TEXT_NODE") {
      continue;
    }

    if (current.attributes.id) {
      pathParts.length = 0; // Reset path, start from id
      pathParts.push(`#${escapeSelector(current.attributes.id)}`);
    } else if (i > 0) {
      const parent = path[i - 1]!;
      const sameTagSiblings = parent.children.filter((c) => c.tagName.toLowerCase() === currentTag);

      if (sameTagSiblings.length === 1) {
        pathParts.push(currentTag);
      } else {
        const index = sameTagSiblings.findIndex((c) => c.nodeId === current.nodeId);
        pathParts.push(`${currentTag}:nth-of-type(${index + 1})`);
      }
    } else {
      pathParts.push(currentTag);
    }
  }

  return pathParts.join(" > ");
}

/**
 * Escape special characters in CSS selector values
 * Also handles identifiers starting with digits (invalid in CSS without escaping)
 */
function escapeSelector(value: string): string {
  // Escape special characters
  let escaped = value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");

  // CSS identifiers cannot start with a digit - escape using hex format \XX
  if (/^[0-9]/.test(escaped)) {
    const firstChar = escaped.charAt(0);
    const hexCode = firstChar.charCodeAt(0).toString(16);
    escaped = `\\${hexCode} ${escaped.slice(1)}`;
  }

  return escaped;
}

/**
 * Build attribute string for a node
 */
export function buildAttributeString(
  node: RawDOMNode,
  includeAttributes: string[] = DEFAULT_INCLUDE_ATTRIBUTES
): string {
  const attrs: string[] = [];
  const seenValues = new Set<string>();

  for (const attrName of includeAttributes) {
    const value = node.attributes[attrName];

    if (value === undefined || value === "") {
      continue;
    }

    // Skip duplicate values (deduplication)
    if (seenValues.has(value)) {
      continue;
    }
    seenValues.add(value);

    // Format attribute
    if (value === "" || value === attrName) {
      // Boolean attribute
      attrs.push(attrName);
    } else {
      attrs.push(`${attrName}="${escapeAttribute(value)}"`);
    }
  }

  return attrs.join(" ");
}

/**
 * Escape special characters in attribute values
 */
function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Truncate text content to max length
 */
export function truncateText(text: string, maxLength: number): string {
  const cleaned = text.trim().replace(/\s+/g, " ");

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned.substring(0, maxLength - 3) + "...";
}

/**
 * Get scroll info string for scrollable containers
 */
export function getScrollInfo(node: RawDOMNode): string {
  if (!node.isScrollable || node.clientHeight === 0) {
    return "";
  }

  const totalScrollableHeight = node.scrollHeight;
  const viewportHeight = node.clientHeight;
  const currentScrollTop = node.scrollTop;

  if (totalScrollableHeight <= viewportHeight) {
    return "";
  }

  const pagesAbove = currentScrollTop / viewportHeight;
  const pagesBelow = (totalScrollableHeight - currentScrollTop - viewportHeight) / viewportHeight;

  return `(${pagesAbove.toFixed(1)} pages above, ${pagesBelow.toFixed(1)} pages below)`;
}

/**
 * Check if a node should be output (vs just traversed for children)
 * Browser-use only outputs "meaningful" nodes:
 * - Interactive elements (can be clicked, typed into, etc.)
 * - Scrollable containers
 * - Shadow DOM roots
 * - Iframes
 *
 * Note: Text content is handled separately via text nodes, not element output
 */
function shouldOutput(node: RawDOMNode): boolean {
  // Always output shadow roots
  if (node.nodeType === "DOCUMENT_FRAGMENT_NODE") {
    return true;
  }

  // Always output iframes
  if (node.isFrame) {
    return true;
  }

  // Always output interactive elements
  if (isInteractive(node)) {
    return true;
  }

  // Output scrollable containers
  if (node.isScrollable) {
    return true;
  }

  // All other elements (structural or not) are transparent
  // Their text content is handled via text node children
  return false;
}

/**
 * Serialize a single node to string format
 * Uses flat output - structural elements are traversed but not rendered
 * Text nodes are output as plain text (browser-use style)
 */
function serializeNode(
  node: RawDOMNode,
  ctx: SerializationContext,
  ancestors: RawDOMNode[]
): string[] {
  const tagName = node.tagName.toLowerCase();
  const lines: string[] = [];

  // Handle text nodes - output visible text content directly (browser-use style)
  if (node.nodeType === "TEXT_NODE" || tagName === "#text") {
    const text = node.textContent?.trim();
    // Only include meaningful text (2+ chars, matching browser-use)
    if (text && text.length > 1) {
      lines.push(text);
    }
    return lines;
  }

  // Skip non-visible elements
  if (!isVisible(node)) {
    return [];
  }

  // Handle shadow roots - always output these with marker
  if (node.nodeType === "DOCUMENT_FRAGMENT_NODE") {
    lines.push(`|SHADOW(${node.shadowMode || "open"})|`);

    for (const child of node.children) {
      lines.push(...serializeNode(child, ctx, [...ancestors, node]));
    }

    return lines;
  }

  // Handle iframes - always output with marker
  if (node.isFrame && node.contentDocument) {
    lines.push(`|IFRAME|`);
    lines.push(...serializeNode(node.contentDocument, ctx, []));
    return lines;
  }

  // Determine if this node should be output
  const shouldOutputNode = shouldOutput(node);

  if (shouldOutputNode) {
    // Build the element output line
    const isNodeInteractive = isInteractive(node);
    let prefix = "";

    if (isNodeInteractive) {
      ctx.index++;
      const index = ctx.index;

      // Build and store selector
      const selector = buildSelector(node, ancestors);
      ctx.selectorMap.set(index, selector);

      // Check if this is a new element
      const isNew = ctx.previousState ? !ctx.previousState.has(node.nodeId) : false;
      prefix = isNew ? `*[${index}]` : `[${index}]`;
    }

    // Handle scrollable containers
    if (node.isScrollable) {
      const scrollInfo = getScrollInfo(node);
      if (isNodeInteractive) {
        // Scrollable AND interactive - use [SCROLL[N]] format
        prefix = prefix.replace(/^\[/, "[SCROLL[").replace(/\]$/, "]]");
        if (scrollInfo) {
          prefix = `${prefix} ${scrollInfo}`;
        }
      } else {
        // Scrollable but not interactive
        prefix = "|SCROLL|";
        if (scrollInfo) {
          prefix = `${prefix} ${scrollInfo}`;
        }
      }
    }

    // Build attributes
    const attrString = buildAttributeString(node, ctx.includeAttributes);
    const attrPart = attrString ? ` ${attrString}` : "";

    // Build content - get direct text
    const textContent = truncateText(node.textContent, ctx.maxTextLength);

    // Format element - browser-use uses self-closing style
    if (textContent) {
      lines.push(`${prefix}<${tagName}${attrPart}>${textContent}</${tagName}>`);
    } else {
      lines.push(`${prefix}<${tagName}${attrPart} />`);
    }
  }

  // Always process shadow roots
  for (const shadow of node.shadowRoots) {
    lines.push(...serializeNode(shadow, ctx, [...ancestors, node]));
  }

  // Always process children (even for structural elements)
  for (const child of node.children) {
    lines.push(...serializeNode(child, ctx, [...ancestors, node]));
  }

  return lines;
}

/**
 * Serialize tree to browser-use format string
 * Output is flat - one element per line, no nesting indentation
 */
export function serializeTree(root: RawDOMNode, options: GetLLMTreeOptions = {}): LLMTreeResult {
  const ctx: SerializationContext = {
    index: 0,
    selectorMap: new Map(),
    previousState: options.previousState,
    maxTextLength: options.maxTextLength ?? 100,
    includeAttributes: DEFAULT_INCLUDE_ATTRIBUTES,
  };

  const lines = serializeNode(root, ctx, []);

  return {
    tree: lines.join("\n"),
    selectorMap: ctx.selectorMap,
  };
}

/**
 * Assign indices to interactive elements and build selector map
 * Returns a map of nodeId -> index
 */
export function assignIndices(root: RawDOMNode): Map<number, number> {
  const nodeToIndex = new Map<number, number>();
  let index = 0;

  function walk(node: RawDOMNode): void {
    if (isInteractive(node) && isVisible(node)) {
      index++;
      nodeToIndex.set(node.nodeId, index);
    }

    for (const child of node.children) {
      walk(child);
    }

    for (const shadow of node.shadowRoots) {
      walk(shadow);
    }

    if (node.contentDocument) {
      walk(node.contentDocument);
    }
  }

  walk(root);
  return nodeToIndex;
}

/**
 * Build selector map from node indices
 */
export function buildSelectorMap(
  root: RawDOMNode,
  nodeToIndex: Map<number, number>
): Map<number, string> {
  const selectorMap = new Map<number, string>();

  function walk(node: RawDOMNode, ancestors: RawDOMNode[]): void {
    const index = nodeToIndex.get(node.nodeId);

    if (index !== undefined) {
      const selector = buildSelector(node, ancestors);
      selectorMap.set(index, selector);
    }

    for (const child of node.children) {
      walk(child, [...ancestors, node]);
    }

    for (const shadow of node.shadowRoots) {
      walk(shadow, [...ancestors, node]);
    }

    if (node.contentDocument) {
      walk(node.contentDocument, []);
    }
  }

  walk(root, []);
  return selectorMap;
}
