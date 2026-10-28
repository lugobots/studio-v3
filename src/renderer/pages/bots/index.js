import { createPageHeader } from "../../components/page-header.js";
import { getHost } from "../../lib/api.js";
import { dialogs, reportResult } from "../../lib/dialogs.js";
import { navigate } from "../../lib/router.js";

function folderName(botPath) {
  const trimmed = String(botPath).replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

export async function renderBots(outlet, documentRef = globalThis.document, deps = {}) {
  const host = deps.host || getHost();
  const prompt = deps.dialogs || dialogs;
  const report = deps.reportResult || reportResult;
  const navigateTo = deps.navigate || navigate;
  const config = deps.config || (await host.config.get());
  const paths = Array.isArray(config.bot_paths) ? config.bot_paths : [];

  const page = documentRef.createElement("section");
  page.className = "page page-card";
  page.append(
    createPageHeader({
      eyebrow: "Bots",
      title: "Your bots",
      lede: "Open a saved bot, or add another folder.",
    }),
  );

  const list = documentRef.createElement("div");
  list.className = "bot-list";
  for (const botPath of paths) {
    const row = documentRef.createElement("button");
    row.type = "button";
    row.className = "button bot-row";
    const name = documentRef.createElement("span");
    name.className = "bot-row-name";
    name.textContent = folderName(botPath);
    const full = documentRef.createElement("span");
    full.className = "bot-row-path";
    full.textContent = botPath;
    row.append(name, full);
    row.addEventListener("click", async () => {
      const opened = await host.project.open(botPath);
      if (!opened.ok) {
        await report(prompt, opened);
        return;
      }
      navigateTo(opened.route || "/api-loading");
    });
    list.append(row);
  }

  const add = documentRef.createElement("button");
  add.type = "button";
  add.className = "button button-primary";
  add.textContent = "Add a bot";
  add.addEventListener("click", () => {
    navigateTo("/start-project");
  });

  page.append(list, add);
  outlet.append(page);
}
