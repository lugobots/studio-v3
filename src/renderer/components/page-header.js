export function createPageHeader({ eyebrow, title, lede, version }) {
  const header = document.createElement("header");
  header.className = "page-header";

  const eyebrowEl = document.createElement("p");
  eyebrowEl.className = "eyebrow";
  eyebrowEl.textContent = eyebrow;

  const titleEl = document.createElement("h1");
  titleEl.textContent = title;

  header.append(eyebrowEl, titleEl);

  if (lede) {
    const ledeEl = document.createElement("p");
    ledeEl.className = "lede";
    ledeEl.textContent = lede;
    header.append(ledeEl);
  }

  const versionText = typeof version === "string" ? version.trim() : "";
  if (versionText) {
    const versionEl = document.createElement("p");
    versionEl.className = "page-version";
    versionEl.textContent = `Version ${versionText}`;
    header.append(versionEl);
  }

  return header;
}
