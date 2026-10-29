import { noteStartupProgress } from "../../components/startup-screen.js";
import { createPageHeader } from "../../components/page-header.js";
import { getHost } from "../../lib/api.js";
import { dialogs, reportResult } from "../../lib/dialogs.js";
import { navigate } from "../../lib/router.js";

export function renderStartProject(outlet, documentRef = globalThis.document, deps = {}) {
  const host = deps.host || getHost();
  const prompt = deps.dialogs || dialogs;
  const report = deps.reportResult || reportResult;
  const navigateTo = deps.navigate || navigate;
  const page = documentRef.createElement("section");
  page.className = "page page-card";
  page.append(
    createPageHeader({
      eyebrow: "Welcome",
      title: "Open a bot",
      lede: "Open an existing bot or create one. Both stay inside Studio.",
    }),
  );

  const open = documentRef.createElement("button");
  open.type = "button";
  open.className = "button button-primary";
  open.textContent = "Open existing bot";
  open.addEventListener("click", async () => {
    const picked = await host.project.pickFolder();
    if (!picked.ok) {
      if (!picked.cancelled) {
        await report(prompt, picked);
      }
      return;
    }
    const opened = await host.project.open(picked.folder);
    if (!opened.ok) {
      await report(prompt, opened);
      return;
    }
    navigateTo(opened.route || "/api-loading");
  });

  const form = documentRef.createElement("form");
  form.className = "create-form";
  const language = documentRef.createElement("select");
  language.setAttribute("aria-label", "Bot language");
  for (const [value, label] of [
    ["python", "Python"],
    ["go", "Go"],
    ["typescript", "JavaScript"],
  ]) {
    const option = documentRef.createElement("option");
    option.value = value;
    option.textContent = label;
    language.append(option);
  }
  const create = documentRef.createElement("button");
  create.type = "submit";
  create.className = "button";
  create.textContent = "Create new bot";
  form.append(language, create);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const picked = await host.project.pickFolder();
    if (!picked.ok) {
      if (!picked.cancelled) {
        await report(prompt, picked);
      }
      return;
    }
    let shown = false;
    let closed = false;
    const showWorking = () => {
      if (closed || shown) {
        return;
      }
      shown = true;
      navigateTo("/api-loading");
    };
    const stopProgress =
      host.startup && host.startup.onProgress
        ? host.startup.onProgress((progress) => {
            noteStartupProgress(progress);
            showWorking();
          })
        : () => {};
    try {
      let created = await host.project.create({ folder: picked.folder, language: language.value });
      if (created && created.confirmOverwrite) {
        const accepted = await prompt.confirm({
          title: "Overwrite existing files?",
          body: created.error || "Existing files may be overwritten.",
          confirmLabel: "Continue",
          cancelLabel: "Cancel",
        });
        if (!accepted) {
          closed = true;
          return;
        }
        created = await host.project.create({
          folder: picked.folder,
          language: language.value,
          overwrite: true,
        });
      }
      if (!created.ok) {
        closed = true;
        if (shown) {
          navigateTo("/start-project");
        }
        await report(prompt, created);
        return;
      }
      if (!shown) {
        navigateTo(created.route || "/api-loading");
      }
    } finally {
      stopProgress();
    }
  });

  page.append(open, form);
  outlet.append(page);
}
