const versions = window.studio?.versions ?? {};
const list = document.getElementById("versions");

const items = [
  ["Electron", versions.electron],
  ["Chromium", versions.chrome],
  ["Node.js", versions.node],
];

for (const [label, value] of items) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  const version = document.createElement("code");
  name.textContent = label;
  version.textContent = value ?? "unknown";
  item.append(name, version);
  list.appendChild(item);
}
