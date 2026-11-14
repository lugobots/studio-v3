/** Bot project switch helpers and icon-rail combobox. */

export const NEW_BOT_PROJECT_VALUE = "__new_bot_project__";

export function folderName(botPath) {
  const trimmed = String(botPath).replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/**
 * Open another bot, or no-op when the path is already the current project.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, route?: string, error?: string }>}
 */
export async function switchBotProject({ folder, currentPath, open }) {
  if (!folder) {
    return { ok: false, error: "Choose a bot project." };
  }
  if (folder === currentPath) {
    return { ok: true, skipped: true };
  }
  if (typeof open !== "function") {
    return { ok: false, error: "Open is not available." };
  }
  const opened = await open(folder);
  if (!opened || opened.ok === false) {
    return { ok: false, error: (opened && opened.error) || "Could not open that bot." };
  }
  return { ok: true, route: opened.route || "/api-loading" };
}

/**
 * Build a select/combobox for the icon rail (placed under Settings).
 * @returns {HTMLElement}
 */
export function renderRailBotCombobox(documentRef, {
  config,
  onSelectBot,
  onNewBotProject,
}) {
  const wrap = documentRef.createElement("div");
  wrap.className = "area-rail-bot-project";
  wrap.setAttribute("aria-label", "Bot project");

  const select = documentRef.createElement("select");
  select.className = "area-rail-bot-select";
  select.setAttribute("aria-label", "Bot project");

  const paths = Array.isArray(config?.bot_paths) ? config.bot_paths : [];
  const current = typeof config?.project_path === "string" ? config.project_path : "";

  for (const botPath of paths) {
    const option = documentRef.createElement("option");
    option.value = botPath;
    option.textContent = folderName(botPath);
    option.title = botPath;
    if (botPath === current) {
      option.selected = true;
    }
    select.append(option);
  }

  if (current && paths.includes(current)) {
    select.value = current;
  }

  const createOption = documentRef.createElement("option");
  createOption.value = NEW_BOT_PROJECT_VALUE;
  createOption.textContent = "New bot project";
  select.append(createOption);

  select.addEventListener("change", () => {
    const value = select.value;
    if (value === NEW_BOT_PROJECT_VALUE) {
      if (current && paths.includes(current)) {
        select.value = current;
      }
      if (typeof onNewBotProject === "function") {
        void onNewBotProject();
      }
      return;
    }
    if (typeof onSelectBot === "function") {
      void onSelectBot(value);
    }
  });

  wrap.append(select);
  return wrap;
}
