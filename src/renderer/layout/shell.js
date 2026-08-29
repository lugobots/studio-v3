export function createShell() {
  const root = document.createElement("div");
  root.className = "shell";

  const outlet = document.createElement("div");
  outlet.className = "shell-outlet";
  outlet.id = "outlet";

  root.append(outlet);
  return { root, outlet };
}
