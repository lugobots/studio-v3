import { createPageHeader } from "../../components/page-header.js";
import { navigate } from "../../lib/router.js";

export function renderLoading(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";

  page.append(
    createPageHeader({
      eyebrow: "Studio v3",
      title: "Loading",
      lede: "Placeholder startup screen. Logic will go here later.",
    }),
  );

  const next = document.createElement("button");
  next.type = "button";
  next.className = "button";
  next.textContent = "Continue (dummy)";
  next.addEventListener("click", () => navigate("/docker-check"));

  page.append(next);
  outlet.append(page);
}
