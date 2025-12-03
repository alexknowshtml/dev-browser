/**
 * CDP Backend Node ID Resolution
 *
 * Resolves CSS selectors to CDP backendNodeIds for reliable element identification
 * across script invocations.
 */

import type { Page, BrowserContext, CDPSession } from "playwright";

/**
 * Resolve CSS selectors from selectorMap to CDP backendNodeIds
 *
 * @param page - Playwright Page object
 * @param context - Playwright BrowserContext
 * @param selectorMap - Map of index to CSS selector from serializeTree
 * @returns Map of index to backendNodeId
 */
export async function resolveBackendIds(
  page: Page,
  context: BrowserContext,
  selectorMap: Map<number, string>
): Promise<Map<number, number>> {
  const cdpSession = await context.newCDPSession(page);
  const indexToBackendId = new Map<number, number>();

  try {
    // Get document root
    const { root } = await cdpSession.send("DOM.getDocument", { depth: 0 });

    for (const [index, selector] of selectorMap) {
      try {
        // Use DOM.querySelector to find element
        const { nodeId } = await cdpSession.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: selector,
        });

        if (nodeId && nodeId !== 0) {
          // Get the backendNodeId from the node
          const { node } = await cdpSession.send("DOM.describeNode", {
            nodeId,
          });
          indexToBackendId.set(index, node.backendNodeId);
        }
      } catch {
        // Selector might not match - element may have been removed
        // or selector is invalid for CDP (e.g., complex pseudo-selectors)
      }
    }

    return indexToBackendId;
  } finally {
    await cdpSession.detach();
  }
}

/**
 * Resolve a backendNodeId to a CSS selector
 *
 * @param page - Playwright Page object
 * @param context - Playwright BrowserContext
 * @param backendNodeId - CDP backend node ID
 * @returns CSS selector for the element
 */
export async function resolveSelectorFromBackendId(
  page: Page,
  context: BrowserContext,
  backendNodeId: number
): Promise<string> {
  const cdpSession = await context.newCDPSession(page);

  try {
    // Resolve backendNodeId to a remote object
    const { object } = await cdpSession.send("DOM.resolveNode", {
      backendNodeId,
      objectGroup: "devbrowser-selector",
    });

    if (!object.objectId) {
      throw new Error("Could not resolve node to object");
    }

    // Build selector in page context
    const result = await cdpSession.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: BUILD_SELECTOR_FUNCTION,
      returnByValue: true,
    });

    // Release the object group
    await cdpSession.send("Runtime.releaseObjectGroup", {
      objectGroup: "devbrowser-selector",
    });

    if (result.exceptionDetails) {
      throw new Error(`Failed to build selector: ${result.exceptionDetails.text}`);
    }

    return result.result.value as string;
  } finally {
    await cdpSession.detach();
  }
}

/**
 * JavaScript function string injected into page context to build a CSS selector
 * Uses priority: id > data-testid > name (for form elements) > nth-of-type path
 * Note: This runs in browser context via CDP Runtime.callFunctionOn
 */
const BUILD_SELECTOR_FUNCTION = `function() {
	// Helper to escape CSS selector values
	function escapeSelector(str) {
		return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\\\\]^\\\`{|}~])/g, '\\\\$1');
	}

	// Priority 1: ID selector
	if (this.id) {
		return '#' + escapeSelector(this.id);
	}

	// Priority 2: data-testid
	var testId = this.getAttribute('data-testid');
	if (testId) {
		return '[data-testid="' + escapeSelector(testId) + '"]';
	}

	// Priority 3: name attribute for form elements
	var tagName = this.tagName.toLowerCase();
	var name = this.getAttribute('name');
	if (name && ['input', 'select', 'textarea'].indexOf(tagName) !== -1) {
		return tagName + '[name="' + escapeSelector(name) + '"]';
	}

	// Priority 4: Build nth-of-type path from body
	var path = [];
	var el = this;

	while (el && el !== document.body && el.parentElement) {
		var tag = el.tagName.toLowerCase();
		var parent = el.parentElement;
		var siblings = Array.from(parent.children).filter(function(c) {
			return c.tagName.toLowerCase() === tag;
		});

		if (siblings.length > 1) {
			var idx = siblings.indexOf(el) + 1;
			path.unshift(tag + ':nth-of-type(' + idx + ')');
		} else {
			path.unshift(tag);
		}

		el = parent;
	}

	return path.length > 0 ? 'body > ' + path.join(' > ') : tagName;
}`;

/**
 * Check if a backendNodeId is still valid (element exists in DOM)
 *
 * @param page - Playwright Page object
 * @param context - Playwright BrowserContext
 * @param backendNodeId - CDP backend node ID
 * @returns true if element exists, false otherwise
 */
export async function isBackendNodeIdValid(
  page: Page,
  context: BrowserContext,
  backendNodeId: number
): Promise<boolean> {
  const cdpSession = await context.newCDPSession(page);

  try {
    await cdpSession.send("DOM.resolveNode", {
      backendNodeId,
    });
    return true;
  } catch {
    return false;
  } finally {
    await cdpSession.detach();
  }
}
