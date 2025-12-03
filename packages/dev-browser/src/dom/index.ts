/**
 * DOM Tree Extraction for LLM
 *
 * Main entry point for extracting DOM tree in browser-use format.
 * Usage:
 *   import { getLLMTree } from 'dev-browser/dom';
 *   const { tree, selectorMap } = await getLLMTree(page);
 */

import type { Page, BrowserContext } from "playwright";
import type {
  LLMTreeResult,
  GetLLMTreeOptions,
  RawDOMNode,
  LLMTreeWithBackendIdsResult,
} from "./types.js";
import { extractRawDOM } from "./extract.js";
import { filterVisibleNodes } from "./visibility.js";
import { filterByBboxPropagation, filterByPaintOrder } from "./filters.js";
import { serializeTree } from "./serialize.js";
import {
  resolveBackendIds,
  resolveSelectorFromBackendId,
  isBackendNodeIdValid,
} from "./backend-ids.js";

// Re-export types
export type {
  LLMTreeResult,
  GetLLMTreeOptions,
  RawDOMNode,
  ProcessedNode,
  CompoundComponent,
  BoundingRect,
  LLMTreeWithBackendIdsResult,
} from "./types.js";

// Re-export backend ID utilities
export {
  resolveBackendIds,
  resolveSelectorFromBackendId,
  isBackendNodeIdValid,
} from "./backend-ids.js";

// Re-export utilities
export { extractRawDOM } from "./extract.js";
export { isVisible, isInViewport, filterVisibleNodes, hasMeaningfulContent } from "./visibility.js";
export {
  isInteractive,
  isPropagatingElement,
  getInteractivityScore,
  countInteractiveDescendants,
  shouldMakeScrollableInteractive,
} from "./interactive.js";
export {
  getContainmentPercentage,
  isFullyContained,
  isOpaqueElement,
  isOccludedByPaintOrder,
  flattenTree,
  filterByPaintOrder,
  filterByBboxPropagation,
  getExcludedNodeIds,
  applyFilters,
} from "./filters.js";
export {
  buildSelector,
  buildAttributeString,
  truncateText,
  getScrollInfo,
  serializeTree,
  assignIndices,
  buildSelectorMap,
} from "./serialize.js";
export {
  getCompoundComponents,
  formatCompoundAnnotation,
  hasCompoundComponents,
} from "./compound.js";

/**
 * Extract DOM tree from a Playwright page and serialize to browser-use format
 *
 * @param page - Playwright Page object
 * @param options - Configuration options
 * @returns Object containing serialized tree string and selector map
 *
 * @example
 * ```typescript
 * import { getLLMTree } from 'dev-browser/dom';
 *
 * const { tree, selectorMap } = await getLLMTree(page);
 * console.log(tree);
 * // [1]<button id="submit">Submit</button>
 * // [2]<input type="text" placeholder="Search" />
 *
 * // Use selector map to interact with elements
 * const selector = selectorMap.get(1); // "#submit"
 * await page.click(selector);
 * ```
 */
export async function getLLMTree(
  page: Page,
  options: GetLLMTreeOptions = {}
): Promise<LLMTreeResult> {
  // 1. Extract raw DOM tree via page.evaluate()
  const rawTree = await extractRawDOM(page);

  if (!rawTree) {
    return {
      tree: "",
      selectorMap: new Map(),
    };
  }

  // 2. Apply visibility filtering
  const visibleTree = filterVisibleNodes(rawTree);

  if (!visibleTree) {
    return {
      tree: "",
      selectorMap: new Map(),
    };
  }

  // 3. Apply paint order filtering
  const paintFiltered = filterByPaintOrder(visibleTree);

  // 4. Apply bounding box propagation filtering
  const bboxFiltered = filterByBboxPropagation(paintFiltered);

  // 5. Serialize to browser-use format string
  const result = serializeTree(bboxFiltered, options);

  return result;
}

/**
 * Extract DOM tree and resolve backend node IDs for persistent element identification
 *
 * This function extends getLLMTree by also resolving CDP backendNodeIds for each
 * interactive element. These IDs can be stored on the server and used to build
 * selectors for elements across script invocations.
 *
 * @param page - Playwright Page object
 * @param context - Playwright BrowserContext (needed for CDP session)
 * @param options - Configuration options
 * @returns Object containing tree string, selector map, and backend node ID map
 *
 * @example
 * ```typescript
 * import { getLLMTreeWithBackendIds } from 'dev-browser/dom';
 *
 * const { tree, selectorMap, backendNodeMap } = await getLLMTreeWithBackendIds(page, context);
 *
 * // Store backendNodeMap on server for later use
 * // Later, use resolveSelectorFromBackendId to get selector for element 1
 * const selector = await resolveSelectorFromBackendId(page, context, backendNodeMap.get(1)!);
 * await page.click(selector);
 * ```
 */
export async function getLLMTreeWithBackendIds(
  page: Page,
  context: BrowserContext,
  options: GetLLMTreeOptions = {}
): Promise<LLMTreeWithBackendIdsResult> {
  // 1. Get the standard LLM tree result
  const { tree, selectorMap } = await getLLMTree(page, options);

  if (selectorMap.size === 0) {
    return {
      tree,
      selectorMap,
      backendNodeMap: new Map(),
    };
  }

  // 2. Resolve backend node IDs using CDP
  const backendNodeMap = await resolveBackendIds(page, context, selectorMap);

  return {
    tree,
    selectorMap,
    backendNodeMap,
  };
}

/**
 * Extract DOM tree without serialization
 * Useful for custom processing
 *
 * @param page - Playwright Page object
 * @returns Raw DOM tree node or null if extraction fails
 */
export async function extractDOMTree(page: Page): Promise<RawDOMNode | null> {
  return extractRawDOM(page);
}

/**
 * Process a raw DOM tree with all filters applied
 *
 * @param rawTree - Raw DOM tree from extractDOMTree
 * @returns Filtered DOM tree
 */
export function processTree(rawTree: RawDOMNode): RawDOMNode | null {
  // Apply visibility filtering
  const visibleTree = filterVisibleNodes(rawTree);

  if (!visibleTree) {
    return null;
  }

  // Apply paint order filtering
  const paintFiltered = filterByPaintOrder(visibleTree);

  // Apply bounding box propagation filtering
  const bboxFiltered = filterByBboxPropagation(paintFiltered);

  return bboxFiltered;
}

/**
 * Serialize a processed DOM tree to string format
 *
 * @param tree - Processed DOM tree
 * @param options - Serialization options
 * @returns Serialized tree and selector map
 */
export function serializeDOMTree(tree: RawDOMNode, options: GetLLMTreeOptions = {}): LLMTreeResult {
  return serializeTree(tree, options);
}
