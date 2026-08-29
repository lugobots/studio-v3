import { createPageHeader } from "../../components/page-header.js";
import { navigate } from "../../lib/router.js";

export function renderDockerCheck(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";

  page.append(
    createPageHeader({
      eyebrow: "Setup",
      title: "Docker check",
      lede: "If Docker is missing or stopped, this screen will ask the user to install or start it.",
    }),
  );

  const next = document.createElement("button");
  next.type = "button";
  next.className = "button";
  next.textContent = "Continue (dummy)";
  next.addEventListener("click", () => navigate("/start-project"));

  page.append(next);
  outlet.append(page);
}
