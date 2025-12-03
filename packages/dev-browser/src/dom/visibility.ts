/**
 * Visibility detection for DOM nodes
 * Implements browser-use compatible visibility checks
 */

import type { RawDOMNode, BoundingRect } from "./types.js";

/**
 * Check if a node is visible based on CSS properties
 */
export function isVisible(
  node: RawDOMNode,
  viewportWidth?: number,
  viewportHeight?: number,
  checkViewport: boolean = false
): boolean {
  // Text nodes inherit visibility from parent
  if (node.nodeType === "TEXT_NODE") {
    return true; // Visibility is determined by parent
  }

  // Document fragments (shadow roots) are always "visible"
  if (node.nodeType === "DOCUMENT_FRAGMENT_NODE") {
    return true;
  }

  // Check CSS display property
  if (node.computedStyles.display === "none") {
    return false;
  }

  // Check CSS visibility property
  if (node.computedStyles.visibility === "hidden") {
    return false;
  }

  // Check CSS opacity
  const opacity = parseFloat(node.computedStyles.opacity);
  if (opacity <= 0) {
    // Special case: file inputs with opacity: 0 should still be visible
    // This is a common Bootstrap pattern
    if (node.tagName === "input" && node.attributes.type === "file") {
      return true;
    }
    return false;
  }

  // Check pointer-events: none (element can't be interacted with)
  // Note: We still consider it "visible" for tree purposes, just not interactive

  // Check if element has zero dimensions
  if (node.boundingRect.width === 0 && node.boundingRect.height === 0) {
    // Exception: some elements like hidden inputs have zero size but are still in DOM
    if (node.tagName === "input" && node.attributes.type === "hidden") {
      return false;
    }
    // For other elements, zero size likely means not visible
    // But we'll be lenient here since some elements might be styled differently
  }

  // Check viewport intersection if requested
  if (checkViewport && viewportWidth && viewportHeight) {
    if (!isInViewport(node.boundingRect, viewportWidth, viewportHeight)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a bounding rect intersects with the viewport
 */
export function isInViewport(
  rect: BoundingRect,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number = 0,
  scrollY: number = 0
): boolean {
  // Convert document coordinates to viewport coordinates
  const viewportRect = {
    left: scrollX,
    top: scrollY,
    right: scrollX + viewportWidth,
    bottom: scrollY + viewportHeight,
  };

  const elementRect = {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };

  // Check for intersection
  return !(
    elementRect.right < viewportRect.left ||
    elementRect.left > viewportRect.right ||
    elementRect.bottom < viewportRect.top ||
    elementRect.top > viewportRect.bottom
  );
}

/**
 * Check if an element is visible considering its parent chain
 * Returns false if any ancestor is not visible
 */
export function isVisibleWithAncestors(
  node: RawDOMNode,
  ancestors: RawDOMNode[] = [],
  viewportWidth?: number,
  viewportHeight?: number
): boolean {
  // Check the node itself
  if (!isVisible(node, viewportWidth, viewportHeight)) {
    return false;
  }

  // Check all ancestors
  for (const ancestor of ancestors) {
    if (!isVisible(ancestor)) {
      return false;
    }
  }

  return true;
}

/**
 * Recursively mark visibility on all nodes in a tree
 * Returns the tree with isVisible property populated
 */
export function markVisibility(
  node: RawDOMNode,
  parentVisible: boolean = true,
  viewportWidth?: number,
  viewportHeight?: number
): RawDOMNode & { isVisible: boolean } {
  const nodeVisible = parentVisible && isVisible(node, viewportWidth, viewportHeight);

  const markedNode = {
    ...node,
    isVisible: nodeVisible,
    children: node.children.map((child) =>
      markVisibility(child, nodeVisible, viewportWidth, viewportHeight)
    ),
    shadowRoots: node.shadowRoots.map((shadow) =>
      markVisibility(shadow, nodeVisible, viewportWidth, viewportHeight)
    ),
    contentDocument: node.contentDocument
      ? markVisibility(node.contentDocument, true, viewportWidth, viewportHeight)
      : null,
  };

  return markedNode;
}

/**
 * Filter tree to only include visible nodes
 * Preserves tree structure but removes invisible branches
 */
export function filterVisibleNodes(node: RawDOMNode): RawDOMNode | null {
  // Check if this node is visible
  if (!isVisible(node)) {
    return null;
  }

  // Filter children recursively
  const visibleChildren: RawDOMNode[] = [];
  for (const child of node.children) {
    const filteredChild = filterVisibleNodes(child);
    if (filteredChild) {
      visibleChildren.push(filteredChild);
    }
  }

  // Filter shadow roots
  const visibleShadowRoots: RawDOMNode[] = [];
  for (const shadow of node.shadowRoots) {
    const filteredShadow = filterVisibleNodes(shadow);
    if (filteredShadow) {
      visibleShadowRoots.push(filteredShadow);
    }
  }

  // Filter content document
  let visibleContentDocument: RawDOMNode | null = null;
  if (node.contentDocument) {
    visibleContentDocument = filterVisibleNodes(node.contentDocument);
  }

  return {
    ...node,
    children: visibleChildren,
    shadowRoots: visibleShadowRoots,
    contentDocument: visibleContentDocument,
  };
}

/**
 * Check if element has meaningful content (text or interactive children)
 */
export function hasMeaningfulContent(node: RawDOMNode): boolean {
  // Check for direct text content
  if (node.textContent && node.textContent.trim().length > 0) {
    return true;
  }

  // Check children recursively
  for (const child of node.children) {
    if (child.nodeType === "TEXT_NODE" && child.textContent.trim().length > 0) {
      return true;
    }
    if (hasMeaningfulContent(child)) {
      return true;
    }
  }

  // Check shadow roots
  for (const shadow of node.shadowRoots) {
    if (hasMeaningfulContent(shadow)) {
      return true;
    }
  }

  return false;
}
