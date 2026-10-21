import { createPageHeader } from "../../components/page-header.js";
import { getHost } from "../../lib/api.js";
import { dialogs, reportResult } from "../../lib/dialogs.js";
import { navigate } from "../../lib/router.js";

export function renderStartProject(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";
  page.append(
    createPageHeader({
      eyebrow: "Welcome",
      title: "Open a bot",
      lede: "Open an existing bot or create one. Both stay inside Studio.",
    }),
  );

  const open = document.createElement("button");
  open.type = "button";
  open.className = "button button-primary";
  open.textContent = "Open existing bot";
  open.addEventListener("click", async () => {
    const host = getHost();
    const picked = await host.project.pickFolder();
    if (!picked.ok) {
      if (!picked.cancelled) {
        await reportResult(dialogs, picked);
      }
      return;
    }
    const opened = await host.project.open(picked.folder);
    if (!opened.ok) {
      await reportResult(dialogs, opened);
      return;
    }
    navigate("/main");
  });

  const form = document.createElement("form");
  form.className = "create-form";
  const language = document.createElement("select");
  language.setAttribute("aria-label", "Bot language");
  for (const [value, label] of [
    ["python", "Python"],
    ["typescript", "TypeScript"],
    ["go", "Go"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    language.append(option);
  }
  const create = document.createElement("button");
  create.type = "submit";
  create.className = "button";
  create.textContent = "Create new bot";
  form.append(language, create);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const host = getHost();
    const picked = await host.project.pickFolder();
    if (!picked.ok) {
      if (!picked.cancelled) {
        await reportResult(dialogs, picked);
      }
      return;
    }
    const created = await host.project.create({ folder: picked.folder, language: language.value });
    if (!created.ok) {
      await reportResult(dialogs, created);
      return;
    }
    navigate("/main");
  });

  page.append(open, form);
  outlet.append(page);
}
