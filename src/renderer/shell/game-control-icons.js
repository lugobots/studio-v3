const SVG = "http://www.w3.org/2000/svg";

/** Lucide-compatible stroke icons (24×24) for Workspace game controls. */
export const GAME_CONTROL_ICONS = {
  logs: [
    ["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }],
    ["polyline", { points: "14 2 14 8 20 8" }],
    ["line", { x1: "16", y1: "13", x2: "8", y2: "13" }],
    ["line", { x1: "16", y1: "17", x2: "8", y2: "17" }],
    ["line", { x1: "10", y1: "9", x2: "8", y2: "9" }],
  ],
  editor: [
    ["polyline", { points: "16 18 22 12 16 6" }],
    ["polyline", { points: "8 6 2 12 8 18" }],
  ],
  "editor-close": [
    ["polyline", { points: "16 18 22 12 16 6" }],
    ["polyline", { points: "8 6 2 12 8 18" }],
    ["line", { x1: "4", y1: "4", x2: "20", y2: "20" }],
  ],
  "bot-inactive": [
    ["circle", { cx: "12", cy: "12", r: "7" }],
  ],
  "bot-active": [
    ["circle", { cx: "12", cy: "12", r: "7" }],
    ["circle", { cx: "12", cy: "12", r: "3", fill: "current" }],
  ],
  "bot-running": [
    ["circle", { cx: "12", cy: "12", r: "7" }],
    ["circle", { cx: "12", cy: "12", r: "4", fill: "current" }],
  ],
  "speed-slow": [
    ["polyline", { points: "7 13 12 18 17 13" }],
    ["polyline", { points: "7 6 12 11 17 6" }],
  ],
  "speed-normal": [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["polyline", { points: "12 7 12 12 15 15" }],
  ],
  "speed-fast": [
    ["path", { d: "M13 2 3 14h9l-1 8 10-12h-9l1-8z" }],
  ],
  "opponent-default": [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: "9", cy: "7", r: "4" }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
  ],
  "opponent-zombies": [
    ["circle", { cx: "9", cy: "12", r: "1" }],
    ["circle", { cx: "15", cy: "12", r: "1" }],
    ["path", { d: "M8 20v-2a4 4 0 0 1 8 0v2" }],
    ["path", { d: "M12 2a8 8 0 0 0-8 8v1a3 3 0 0 0 3 3h1" }],
    ["path", { d: "M20 11a8 8 0 0 0-8-9" }],
    ["path", { d: "M9 17h6" }],
  ],
  "opponent-statues": [
    ["rect", { x: "5", y: "5", width: "14", height: "14", rx: "1" }],
    ["line", { x1: "9", y1: "9", x2: "9", y2: "15" }],
    ["line", { x1: "15", y1: "9", x2: "15", y2: "15" }],
  ],
  "opponent-kids": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M8 14s1.5 2 4 2 4-2 4-2" }],
    ["line", { x1: "9", y1: "9", x2: "9.01", y2: "9" }],
    ["line", { x1: "15", y1: "9", x2: "15.01", y2: "9" }],
  ],
  "opponent-defenses": [
    ["path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }],
  ],
};

/**
 * Build a stroke SVG for a named game-control glyph.
 * @param {string} name
 * @param {{ color?: string, size?: number }} [options]
 */
export function createGameControlIcon(name, { color = "currentColor", size = 14 } = {}) {
  const parts = GAME_CONTROL_ICONS[name];
  if (!parts) {
    throw new Error(`Unknown game-control icon: ${name}`);
  }
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("data-icon", name);
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "fill" && value === "current") {
        node.setAttribute("fill", color);
        continue;
      }
      node.setAttribute(key, value);
    }
    if (!node.getAttribute("stroke")) {
      node.setAttribute("stroke", color);
    }
    if (!node.getAttribute("fill")) {
      node.setAttribute("fill", "none");
    }
    node.setAttribute("stroke-width", node.getAttribute("stroke-width") || "2");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    svg.append(node);
  }
  return svg;
}

/** Stable fingerprint of path data so tests can assert shape uniqueness. */
export function iconFingerprint(name) {
  const parts = GAME_CONTROL_ICONS[name];
  if (!parts) {
    return "";
  }
  return parts.map(([tag, attrs]) => `${tag}:${JSON.stringify(attrs)}`).join("|");
}
