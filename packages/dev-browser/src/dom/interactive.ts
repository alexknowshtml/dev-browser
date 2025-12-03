/**
 * Interactive element detection
 * Implements browser-use compatible interactivity checks
 */

import type { RawDOMNode } from "./types.js";
import { INTERACTIVE_TAGS, INTERACTIVE_ROLES, MIN_INTERACTIVE_IFRAME_SIZE } from "./types.js";

/**
 * Set of interactive tags for fast lookup
 */
const INTERACTIVE_TAGS_SET = new Set(INTERACTIVE_TAGS);

/**
 * Set of interactive roles for fast lookup
 */
const INTERACTIVE_ROLES_SET = new Set(INTERACTIVE_ROLES);

/**
 * Check if a node is interactive
 */
export function isInteractive(node: RawDOMNode): boolean {
  // Text nodes are not interactive
  if (node.nodeType === "TEXT_NODE") {
    return false;
  }

  // Document fragments (shadow roots) are not interactive themselves
  if (node.nodeType === "DOCUMENT_FRAGMENT_NODE") {
    return false;
  }

  const tagName = node.tagName.toLowerCase();
  const attributes = node.attributes;

  // Check for hidden inputs - they are not interactive
  if (tagName === "input" && attributes.type === "hidden") {
    return false;
  }

  // Check for inherently interactive tags
  if (INTERACTIVE_TAGS_SET.has(tagName)) {
    return true;
  }

  // Check for interactive ARIA role
  const role = attributes.role?.toLowerCase();
  if (role && INTERACTIVE_ROLES_SET.has(role)) {
    return true;
  }

  // Check for onclick attribute
  if (attributes.onclick !== undefined) {
    return true;
  }

  // Check for other event handlers that indicate interactivity
  const eventHandlers = [
    "onmousedown",
    "onmouseup",
    "onkeydown",
    "onkeyup",
    "ontouchstart",
    "ontouchend",
  ];
  for (const handler of eventHandlers) {
    if (attributes[handler] !== undefined) {
      return true;
    }
  }

  // Check for tabindex >= 0 (element is in tab order)
  if (attributes.tabindex !== undefined) {
    const tabindex = parseInt(attributes.tabindex, 10);
    if (!isNaN(tabindex) && tabindex >= 0) {
      return true;
    }
  }

  // Check for contenteditable
  if (attributes.contenteditable === "true" || attributes.contenteditable === "") {
    return true;
  }

  // Check for cursor: pointer (indicates clickable element)
  if (node.computedStyles.cursor === "pointer") {
    return true;
  }

  // Check for large iframes (they should be interactive)
  if (node.isFrame) {
    const { width, height } = node.boundingRect;
    if (width >= MIN_INTERACTIVE_IFRAME_SIZE && height >= MIN_INTERACTIVE_IFRAME_SIZE) {
      return true;
    }
  }

  // Check for search-related classes/IDs (common pattern for clickable search icons)
  const searchPatterns = ["search", "magnify", "glass", "lookup", "find", "query"];
  const classAttr = (attributes.class || "").toLowerCase();
  const idAttr = (attributes.id || "").toLowerCase();

  for (const pattern of searchPatterns) {
    if (classAttr.includes(pattern) || idAttr.includes(pattern)) {
      // Only if element has clickable cursor
      if (node.computedStyles.cursor === "pointer") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a node is a "propagating" element whose children should be excluded
 * if fully contained within its bounds
 */
export function isPropagatingElement(node: RawDOMNode): boolean {
  const tagName = node.tagName.toLowerCase();
  const role = node.attributes.role?.toLowerCase();

  // Check propagating tags
  if (tagName === "button" || tagName === "a") {
    return true;
  }

  // Check propagating roles on div/span/input
  if (tagName === "div" || tagName === "span" || tagName === "input") {
    if (role === "button" || role === "combobox") {
      return true;
    }
  }

  return false;
}

/**
 * Check if a child should be excluded due to being inside a propagating parent
 * Returns true if the child should be KEPT (not excluded)
 */
export function shouldKeepChildInPropagatingParent(child: RawDOMNode): boolean {
  const tagName = child.tagName.toLowerCase();
  const role = child.attributes.role?.toLowerCase();
  const attributes = child.attributes;

  // Keep text nodes
  if (child.nodeType === "TEXT_NODE") {
    return false; // Text nodes don't need to be interactive
  }

  // Keep form elements
  const formElements = ["input", "select", "textarea", "label"];
  if (formElements.includes(tagName)) {
    return true;
  }

  // Keep elements with onclick handlers
  if (attributes.onclick !== undefined) {
    return true;
  }

  // Keep elements with aria-label (they have semantic meaning)
  if (attributes["aria-label"] !== undefined) {
    return true;
  }

  // Keep elements with interactive roles
  if (role && INTERACTIVE_ROLES_SET.has(role)) {
    return true;
  }

  // Keep other propagating elements (nested buttons/links)
  if (isPropagatingElement(child)) {
    return true;
  }

  return false;
}

/**
 * Get interactivity score for an element (used for prioritization)
 * Higher score = more likely to be the intended interactive element
 */
export function getInteractivityScore(node: RawDOMNode): number {
  let score = 0;

  const tagName = node.tagName.toLowerCase();
  const attributes = node.attributes;
  const role = attributes.role?.toLowerCase();

  // Explicit interactive tags get highest score
  if (tagName === "button") score += 10;
  else if (tagName === "a" && attributes.href) score += 9;
  else if (tagName === "input") score += 8;
  else if (tagName === "select") score += 8;
  else if (tagName === "textarea") score += 8;
  else if (tagName === "a") score += 7;

  // ARIA roles
  if (role === "button") score += 6;
  else if (role === "link") score += 5;
  else if (INTERACTIVE_ROLES_SET.has(role || "")) score += 4;

  // Event handlers
  if (attributes.onclick) score += 3;
  if (attributes.tabindex !== undefined) {
    const tabindex = parseInt(attributes.tabindex, 10);
    if (!isNaN(tabindex) && tabindex >= 0) score += 2;
  }

  // Cursor pointer
  if (node.computedStyles.cursor === "pointer") score += 1;

  return score;
}

/**
 * Count interactive descendants of a node
 */
export function countInteractiveDescendants(node: RawDOMNode): number {
  let count = 0;

  for (const child of node.children) {
    if (isInteractive(child)) {
      count++;
    }
    count += countInteractiveDescendants(child);
  }

  for (const shadow of node.shadowRoots) {
    count += countInteractiveDescendants(shadow);
  }

  return count;
}

/**
 * Check if a scrollable container should be made interactive
 * Per browser-use: scrollable containers with NO interactive descendants should be interactive
 */
export function shouldMakeScrollableInteractive(node: RawDOMNode): boolean {
  if (!node.isScrollable) {
    return false;
  }

  // Check if there are any interactive descendants
  const interactiveDescendants = countInteractiveDescendants(node);
  return interactiveDescendants === 0;
}
