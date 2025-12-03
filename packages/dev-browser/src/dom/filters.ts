/**
 * Paint order and bounding box filtering
 * Implements browser-use compatible filtering for occluded and propagating elements
 */

import type { RawDOMNode, BoundingRect, ProcessedNode } from "./types.js";
import {
  isInteractive,
  isPropagatingElement,
  shouldKeepChildInPropagatingParent,
} from "./interactive.js";

/**
 * Check if rect1 is fully contained within rect2
 * Returns containment percentage (0-1)
 */
export function getContainmentPercentage(inner: BoundingRect, outer: BoundingRect): number {
  // Calculate intersection
  const intersectLeft = Math.max(inner.x, outer.x);
  const intersectRight = Math.min(inner.x + inner.width, outer.x + outer.width);
  const intersectTop = Math.max(inner.y, outer.y);
  const intersectBottom = Math.min(inner.y + inner.height, outer.y + outer.height);

  if (intersectRight <= intersectLeft || intersectBottom <= intersectTop) {
    return 0; // No intersection
  }

  const intersectionArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
  const innerArea = inner.width * inner.height;

  if (innerArea === 0) return 0;

  return intersectionArea / innerArea;
}

/**
 * Check if an element is fully contained within another (99% threshold per browser-use)
 */
export function isFullyContained(inner: BoundingRect, outer: BoundingRect): boolean {
  return getContainmentPercentage(inner, outer) >= 0.99;
}

/**
 * Check if an overlay element is opaque (has solid background)
 */
export function isOpaqueElement(node: RawDOMNode): boolean {
  const bgColor = node.computedStyles.backgroundColor;

  if (!bgColor || bgColor === "transparent" || bgColor === "rgba(0, 0, 0, 0)") {
    return false;
  }

  // Check for rgba with alpha < 1
  const rgbaMatch = bgColor.match(/rgba?\([\d.]+,\s*[\d.]+,\s*[\d.]+(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch && rgbaMatch[1] !== undefined) {
    const alpha = parseFloat(rgbaMatch[1]);
    if (alpha < 0.9) {
      return false;
    }
  }

  return true;
}

/**
 * Check if an element is occluded by later-painted opaque elements
 * Returns true if the element should be EXCLUDED (is fully covered)
 */
export function isOccludedByPaintOrder(node: RawDOMNode, allNodes: RawDOMNode[]): boolean {
  if (!node.boundingRect || node.boundingRect.width === 0 || node.boundingRect.height === 0) {
    return false;
  }

  // Find all elements that are painted after this one
  const laterPainted = allNodes.filter((other) => other.paintOrder > node.paintOrder);

  for (const overlayNode of laterPainted) {
    // Skip if no valid bounding rect
    if (
      !overlayNode.boundingRect ||
      overlayNode.boundingRect.width === 0 ||
      overlayNode.boundingRect.height === 0
    ) {
      continue;
    }

    // Check if overlay fully covers this element
    if (isFullyContained(node.boundingRect, overlayNode.boundingRect)) {
      // Check if overlay is opaque
      if (isOpaqueElement(overlayNode)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Collect all nodes in the tree into a flat array
 */
export function flattenTree(node: RawDOMNode): RawDOMNode[] {
  const nodes: RawDOMNode[] = [node];

  for (const child of node.children) {
    nodes.push(...flattenTree(child));
  }

  for (const shadow of node.shadowRoots) {
    nodes.push(...flattenTree(shadow));
  }

  if (node.contentDocument) {
    nodes.push(...flattenTree(node.contentDocument));
  }

  return nodes;
}

/**
 * Filter nodes that are occluded by later-painted opaque elements
 * Returns a new tree with occluded interactive elements marked
 */
export function filterByPaintOrder(root: RawDOMNode): RawDOMNode {
  const allNodes = flattenTree(root);

  function processNode(node: RawDOMNode): RawDOMNode {
    // Create a copy of the node
    const processed: RawDOMNode = {
      ...node,
      children: node.children.map(processNode),
      shadowRoots: node.shadowRoots.map(processNode),
      contentDocument: node.contentDocument ? processNode(node.contentDocument) : null,
    };

    return processed;
  }

  return processNode(root);
}

/**
 * Apply bounding box propagation filtering
 * For propagating elements (buttons, links, etc.), mark children as excluded
 * if they are fully contained within the parent's bounds
 */
export function filterByBboxPropagation(root: RawDOMNode): RawDOMNode {
  function processNode(node: RawDOMNode, propagatingAncestor: RawDOMNode | null): RawDOMNode {
    // Check if this node should be a new propagating ancestor
    const isThisPropagating = isPropagatingElement(node);
    const newPropagatingAncestor = isThisPropagating ? node : propagatingAncestor;

    // Process children
    const processedChildren: RawDOMNode[] = [];

    for (const child of node.children) {
      // If this node IS a propagating element, check if its children should be excluded
      // OR if we have a propagating ancestor, check containment against it
      const ancestorToCheck = isThisPropagating ? node : propagatingAncestor;

      if (ancestorToCheck) {
        // Check if child is fully contained within propagating ancestor
        const isContained = isFullyContained(child.boundingRect, ancestorToCheck.boundingRect);

        // If contained and shouldn't be kept, skip this child (don't add to tree)
        if (isContained && !shouldKeepChildInPropagatingParent(child)) {
          continue;
        }
      }

      // Process child recursively
      processedChildren.push(processNode(child, newPropagatingAncestor));
    }

    // Process shadow roots and content documents
    const processedShadowRoots = node.shadowRoots.map((s) =>
      processNode(s, newPropagatingAncestor)
    );
    const processedContentDocument = node.contentDocument
      ? processNode(node.contentDocument, null) // Reset propagating ancestor for iframes
      : null;

    return {
      ...node,
      children: processedChildren,
      shadowRoots: processedShadowRoots,
      contentDocument: processedContentDocument,
    };
  }

  return processNode(root, null);
}

/**
 * Check if a child should be excluded from a propagating parent
 * Returns true if the child SHOULD be excluded
 */
export function shouldExcludeFromPropagatingParent(child: RawDOMNode, parent: RawDOMNode): boolean {
  // Must be a propagating parent
  if (!isPropagatingElement(parent)) {
    return false;
  }

  // Must be fully contained
  if (!isFullyContained(child.boundingRect, parent.boundingRect)) {
    return false;
  }

  // Keep if it's a special element that should be preserved
  if (shouldKeepChildInPropagatingParent(child)) {
    return false;
  }

  return true;
}

/**
 * Get all nodes that should be marked as occluded or propagated
 * Returns a Set of nodeIds that should be excluded
 */
export function getExcludedNodeIds(root: RawDOMNode): Set<number> {
  const excluded = new Set<number>();
  const allNodes = flattenTree(root);

  // Check paint order occlusion
  for (const node of allNodes) {
    if (isInteractive(node) && isOccludedByPaintOrder(node, allNodes)) {
      excluded.add(node.nodeId);
    }
  }

  // Check bbox propagation
  function checkBboxPropagation(node: RawDOMNode, propagatingAncestor: RawDOMNode | null): void {
    const isThisPropagating = isPropagatingElement(node);
    const newAncestor = isThisPropagating ? node : propagatingAncestor;

    for (const child of node.children) {
      // Check against current node if it's propagating, or against ancestor
      const ancestorToCheck = isThisPropagating ? node : propagatingAncestor;

      if (ancestorToCheck) {
        if (shouldExcludeFromPropagatingParent(child, ancestorToCheck)) {
          excluded.add(child.nodeId);
        }
      }
      checkBboxPropagation(child, newAncestor);
    }

    for (const shadow of node.shadowRoots) {
      checkBboxPropagation(shadow, newAncestor);
    }

    if (node.contentDocument) {
      checkBboxPropagation(node.contentDocument, null);
    }
  }

  checkBboxPropagation(root, null);

  return excluded;
}

/**
 * Apply all filters and return processed tree
 */
export function applyFilters(root: RawDOMNode): RawDOMNode {
  // Apply paint order filtering first
  let filtered = filterByPaintOrder(root);

  // Then apply bbox propagation
  filtered = filterByBboxPropagation(filtered);

  return filtered;
}
