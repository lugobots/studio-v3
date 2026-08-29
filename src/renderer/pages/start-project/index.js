import { createPageHeader } from "../../components/page-header.js";

export function renderStartProject(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";

  page.append(
    createPageHeader({
      eyebrow: "Setup",
      title: "Start project",
      lede: "Shown when a project has not been created yet.",
    }),
  );

  outlet.append(page);
}
