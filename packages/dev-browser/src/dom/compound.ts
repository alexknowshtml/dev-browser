/**
 * Compound component generation
 * Adds virtual sub-components for complex input types
 */

import type { RawDOMNode, CompoundComponent } from "./types.js";

/**
 * Generate compound components for a node
 */
export function getCompoundComponents(node: RawDOMNode): CompoundComponent[] {
  const tagName = node.tagName.toLowerCase();
  const inputType = node.attributes.type?.toLowerCase();

  // Select dropdowns
  if (tagName === "select") {
    return getSelectCompounds(node);
  }

  // Input types
  if (tagName === "input") {
    switch (inputType) {
      case "file":
        return getFileInputCompounds(node);
      case "range":
        return getRangeInputCompounds(node);
      case "number":
        return getNumberInputCompounds(node);
      case "date":
        return getDateInputCompounds(node, "YYYY-MM-DD");
      case "time":
        return getDateInputCompounds(node, "HH:MM");
      case "datetime-local":
        return getDateInputCompounds(node, "YYYY-MM-DDTHH:MM");
      case "color":
        return getColorInputCompounds(node);
      default:
        return [];
    }
  }

  // Video element
  if (tagName === "video") {
    return getVideoCompounds(node);
  }

  // Audio element
  if (tagName === "audio") {
    return getAudioCompounds(node);
  }

  // Details/Summary
  if (tagName === "details") {
    return getDetailsCompounds(node);
  }

  return [];
}

/**
 * Get compound components for select element
 */
function getSelectCompounds(node: RawDOMNode): CompoundComponent[] {
  const components: CompoundComponent[] = [];

  // Find option children
  const options = node.children.filter((c) => c.tagName.toLowerCase() === "option");

  // Get first 4 options + count of remaining
  const displayOptions = options.slice(0, 4).map((opt) => {
    return opt.textContent || opt.attributes.value || "";
  });

  const remainingCount = Math.max(0, options.length - 4);
  if (remainingCount > 0) {
    displayOptions.push(`... +${remainingCount} more`);
  }

  // Dropdown Toggle
  components.push({
    name: "Dropdown Toggle",
    role: "combobox",
    options: displayOptions,
    current: getSelectedOptionText(node, options),
  });

  return components;
}

/**
 * Get selected option text
 */
function getSelectedOptionText(selectNode: RawDOMNode, options: RawDOMNode[]): string | undefined {
  // Find selected option
  const selected = options.find((opt) => opt.attributes.selected !== undefined);

  if (selected) {
    return selected.textContent || selected.attributes.value;
  }

  // Default to first option
  if (options.length > 0) {
    return options[0].textContent || options[0].attributes.value;
  }

  return undefined;
}

/**
 * Get compound components for file input
 */
function getFileInputCompounds(node: RawDOMNode): CompoundComponent[] {
  const components: CompoundComponent[] = [];
  const isMultiple = node.attributes.multiple !== undefined;
  const accept = node.attributes.accept;

  components.push({
    name: "Browse Files",
    role: "button",
  });

  components.push({
    name: isMultiple ? "Files Selected" : "File Selected",
    role: "textbox",
    format: accept ? `Accepts: ${accept}` : undefined,
  });

  return components;
}

/**
 * Get compound components for range input (slider)
 */
function getRangeInputCompounds(node: RawDOMNode): CompoundComponent[] {
  const min = parseFloat(node.attributes.min || "0");
  const max = parseFloat(node.attributes.max || "100");
  const current = parseFloat(node.attributes.value || String((min + max) / 2));
  const step = node.attributes.step;

  const component: CompoundComponent = {
    name: "Slider",
    role: "slider",
    min,
    max,
    current: String(current),
  };

  if (step) {
    component.format = `Step: ${step}`;
  }

  return [component];
}

/**
 * Get compound components for number input
 */
function getNumberInputCompounds(node: RawDOMNode): CompoundComponent[] {
  const components: CompoundComponent[] = [];
  const min = node.attributes.min;
  const max = node.attributes.max;
  const current = node.attributes.value;

  // Decrement button
  components.push({
    name: "Decrement",
    role: "button",
  });

  // Value textbox
  const valueComponent: CompoundComponent = {
    name: "Value",
    role: "spinbutton",
    current,
  };

  if (min !== undefined) {
    valueComponent.min = parseFloat(min);
  }
  if (max !== undefined) {
    valueComponent.max = parseFloat(max);
  }

  components.push(valueComponent);

  // Increment button
  components.push({
    name: "Increment",
    role: "button",
  });

  return components;
}

/**
 * Get compound components for date/time inputs
 */
function getDateInputCompounds(node: RawDOMNode, format: string): CompoundComponent[] {
  return [
    {
      name: "Date Picker",
      role: "textbox",
      format,
      current: node.attributes.value,
    },
  ];
}

/**
 * Get compound components for color input
 */
function getColorInputCompounds(node: RawDOMNode): CompoundComponent[] {
  return [
    {
      name: "Color Picker",
      role: "button",
      current: node.attributes.value || "#000000",
      format: "Hex color",
    },
  ];
}

/**
 * Get compound components for video element
 */
function getVideoCompounds(node: RawDOMNode): CompoundComponent[] {
  const hasControls = node.attributes.controls !== undefined;

  if (!hasControls) {
    return [];
  }

  return [
    { name: "Play/Pause", role: "button" },
    { name: "Progress", role: "slider", min: 0, max: 100 },
    { name: "Volume", role: "slider", min: 0, max: 100 },
    { name: "Mute", role: "button" },
    { name: "Fullscreen", role: "button" },
  ];
}

/**
 * Get compound components for audio element
 */
function getAudioCompounds(node: RawDOMNode): CompoundComponent[] {
  const hasControls = node.attributes.controls !== undefined;

  if (!hasControls) {
    return [];
  }

  return [
    { name: "Play/Pause", role: "button" },
    { name: "Progress", role: "slider", min: 0, max: 100 },
    { name: "Volume", role: "slider", min: 0, max: 100 },
    { name: "Mute", role: "button" },
  ];
}

/**
 * Get compound components for details element
 */
function getDetailsCompounds(node: RawDOMNode): CompoundComponent[] {
  const isOpen = node.attributes.open !== undefined;

  return [
    {
      name: "Toggle",
      role: "button",
      current: isOpen ? "expanded" : "collapsed",
    },
  ];
}

/**
 * Format compound components as annotation string
 */
export function formatCompoundAnnotation(components: CompoundComponent[]): string {
  if (components.length === 0) {
    return "";
  }

  const parts = components.map((comp) => {
    let str = `${comp.name} (${comp.role})`;

    if (comp.min !== undefined && comp.max !== undefined) {
      str += ` [${comp.min}-${comp.max}]`;
    }

    if (comp.current !== undefined) {
      str += `: ${comp.current}`;
    }

    if (comp.format !== undefined) {
      str += ` (${comp.format})`;
    }

    if (comp.options && comp.options.length > 0) {
      str += ` Options: [${comp.options.join(", ")}]`;
    }

    return str;
  });

  return `{${parts.join(" | ")}}`;
}

/**
 * Check if a node has compound components
 */
export function hasCompoundComponents(node: RawDOMNode): boolean {
  const tagName = node.tagName.toLowerCase();
  const inputType = node.attributes.type?.toLowerCase();

  if (tagName === "select") return true;
  if (tagName === "video" && node.attributes.controls !== undefined) return true;
  if (tagName === "audio" && node.attributes.controls !== undefined) return true;
  if (tagName === "details") return true;

  if (tagName === "input") {
    const compoundTypes = ["file", "range", "number", "date", "time", "datetime-local", "color"];
    return compoundTypes.includes(inputType || "");
  }

  return false;
}
