/**
 * Type definitions for DOM tree extraction
 * Implements browser-use compatible data structures
 */

/**
 * Bounding rectangle in document coordinates
 */
export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computed styles relevant for visibility and interactivity detection
 */
export interface ComputedStyles {
  display: string;
  visibility: string;
  opacity: string;
  cursor: string;
  backgroundColor: string;
  overflow: string;
  overflowX: string;
  overflowY: string;
  pointerEvents: string;
}

/**
 * Raw DOM node extracted from page.evaluate()
 * Contains all data needed for processing
 */
export interface RawDOMNode {
  /** Unique node identifier within extraction */
  nodeId: number;

  /** Node type: element, text, or document fragment */
  nodeType: "ELEMENT_NODE" | "TEXT_NODE" | "DOCUMENT_FRAGMENT_NODE";

  /** HTML tag name (lowercase) */
  tagName: string;

  /** All HTML attributes */
  attributes: Record<string, string>;

  /** Direct text content (for text nodes or elements with text) */
  textContent: string;

  /** Bounding rectangle in document coordinates */
  boundingRect: BoundingRect;

  /** Relevant computed styles */
  computedStyles: ComputedStyles;

  /** Whether element can scroll */
  isScrollable: boolean;

  /** Current scroll position */
  scrollTop: number;
  scrollLeft: number;

  /** Total scrollable height */
  scrollHeight: number;
  scrollWidth: number;

  /** Visible area dimensions */
  clientHeight: number;
  clientWidth: number;

  /** Paint order for occlusion detection */
  paintOrder: number;

  /** Child nodes */
  children: RawDOMNode[];

  /** Shadow DOM roots (open or closed) */
  shadowRoots: RawDOMNode[];

  /** Shadow DOM mode if this is a shadow host */
  shadowMode?: "open" | "closed";

  /** Content document for iframes */
  contentDocument: RawDOMNode | null;

  /** Whether this is an iframe or frame element */
  isFrame: boolean;

  /** Frame URL for iframes */
  frameUrl?: string;

  /** Viewport dimensions (for root node) */
  viewportWidth?: number;
  viewportHeight?: number;
}

/**
 * Compound component for complex form elements
 * Used to expose virtual sub-components to the LLM
 */
export interface CompoundComponent {
  /** Component name (e.g., "Dropdown Toggle", "Browse Files") */
  name: string;

  /** ARIA role */
  role: string;

  /** Min value for sliders/spinbuttons */
  min?: number;

  /** Max value for sliders/spinbuttons */
  max?: number;

  /** Current value */
  current?: string;

  /** Options for select/listbox */
  options?: string[];

  /** Option count for large lists */
  count?: number;

  /** Format hint for date/time inputs */
  format?: string;
}

/**
 * Processed node with computed properties
 * Ready for serialization
 */
export interface ProcessedNode extends RawDOMNode {
  /** Whether element passes visibility checks */
  isVisible: boolean;

  /** Whether element is interactive */
  isInteractive: boolean;

  /** Interactive element index (null if not interactive) */
  interactiveIndex: number | null;

  /** Whether element is new since last extraction */
  isNew: boolean;

  /** Whether element is ignored due to paint order occlusion */
  ignoredByPaintOrder: boolean;

  /** Whether element is ignored due to parent bbox propagation */
  ignoredByBboxPropagation: boolean;

  /** Scroll information for scrollable containers */
  scrollInfo?: {
    pagesAbove: number;
    pagesBelow: number;
    scrollPercentage: number;
  };

  /** Compound components for complex inputs */
  compoundComponents?: CompoundComponent[];

  /** Processed children */
  children: ProcessedNode[];

  /** Processed shadow roots */
  shadowRoots: ProcessedNode[];

  /** Processed content document */
  contentDocument: ProcessedNode | null;
}

/**
 * Result of getLLMTree extraction
 */
export interface LLMTreeResult {
  /** Formatted tree string in browser-use format */
  tree: string;

  /** Map of interactive index to CSS selector */
  selectorMap: Map<number, string>;
}

/**
 * Result of getLLMTreeWithBackendIds extraction
 * Extends LLMTreeResult with CDP backendNodeIds for persistent element identification
 */
export interface LLMTreeWithBackendIdsResult extends LLMTreeResult {
  /** Map of interactive index to CDP backendNodeId */
  backendNodeMap: Map<number, number>;
}

/**
 * Options for getLLMTree extraction
 */
export interface GetLLMTreeOptions {
  /** Previous state for detecting new elements */
  previousState?: Map<number, boolean>;

  /** Include iframe content documents (default: true) */
  includeIframes?: boolean;

  /** Include shadow DOM content (default: true) */
  includeShadowDOM?: boolean;

  /** Maximum text content length before truncation (default: 100) */
  maxTextLength?: number;

  /** Attributes to include in output */
  includeAttributes?: string[];

  /** Enable paint order filtering (default: true) */
  enablePaintOrderFiltering?: boolean;

  /** Enable bounding box propagation filtering (default: true) */
  enableBboxFiltering?: boolean;
}

/**
 * Default attributes to include in serialized output
 * Matches browser-use defaults
 */
export const DEFAULT_INCLUDE_ATTRIBUTES = [
  // Core attributes
  "type",
  "id",
  "name",
  "role",
  "class",

  // Form attributes
  "placeholder",
  "value",
  "checked",
  "selected",
  "disabled",
  "required",
  "readonly",

  // ARIA attributes
  "aria-label",
  "aria-expanded",
  "aria-checked",
  "aria-disabled",
  "aria-placeholder",
  "aria-valuemin",
  "aria-valuemax",
  "aria-valuenow",

  // Link attributes
  "href",
  "target",

  // Media attributes
  "alt",
  "title",
  "src",

  // Validation attributes
  "min",
  "max",
  "minlength",
  "maxlength",
  "pattern",
  "step",
  "inputmode",
  "autocomplete",
  "accept",
  "multiple",

  // Data attributes
  "data-testid",
  "data-date-format",

  // Content editable
  "contenteditable",

  // Tabindex
  "tabindex",
];

/**
 * Tags that are inherently interactive
 */
export const INTERACTIVE_TAGS = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  "details",
  "summary",
  "option",
  "optgroup",
];

/**
 * ARIA roles that indicate interactivity
 */
export const INTERACTIVE_ROLES = [
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "checkbox",
  "tab",
  "textbox",
  "combobox",
  "slider",
  "spinbutton",
  "listbox",
  "searchbox",
  "switch",
  "treeitem",
];

/**
 * Tags whose children should be excluded if fully contained (bbox propagation)
 */
export const PROPAGATING_TAGS = ["button", "a"];

/**
 * Roles whose children should be excluded if fully contained
 */
export const PROPAGATING_ROLES = ["button", "combobox"];

/**
 * Tags that should be excluded from the tree entirely
 */
export const EXCLUDED_TAGS = ["script", "style", "noscript", "meta", "link", "head", "title"];

/**
 * Minimum iframe dimensions to be considered interactive
 */
export const MIN_INTERACTIVE_IFRAME_SIZE = 100;
