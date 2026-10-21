import { createPageHeader } from "../../components/page-header.js";
import { getHost } from "../../lib/api.js";
import { navigate } from "../../lib/router.js";

export function renderLoading(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";
  page.append(
    createPageHeader({
      eyebrow: "Studio v3",
      title: "Starting",
      lede: "Checking Docker and your bot.",
    }),
  );
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "button";
  retry.textContent = "Check again";
  retry.addEventListener("click", async () => {
    const next = await getHost().startup.next();
    navigate(next.route);
  });
  page.append(retry);
  outlet.append(page);
}
