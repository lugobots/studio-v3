import { createPageHeader } from "../../components/page-header.js";
import { getHost } from "../../lib/api.js";
import { dialogs, reportResult } from "../../lib/dialogs.js";
import { navigate } from "../../lib/router.js";

export function renderDockerCheck(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";
  page.append(
    createPageHeader({
      eyebrow: "Setup",
      title: "Docker",
      lede: "Start or install Docker, then check again. Studio stays here until the daemon is running.",
    }),
  );
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "button button-primary";
  retry.textContent = "Check again";
  retry.addEventListener("click", async () => {
    const host = getHost();
    const status = await host.docker.status();
    if (status.unsupported) {
      await reportResult(dialogs, status);
      navigate("/main");
      return;
    }
    const next = await host.startup.next();
    navigate(next.route);
  });
  page.append(retry);
  outlet.append(page);
}
