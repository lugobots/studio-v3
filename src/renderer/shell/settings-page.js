import { normalizeAppearance } from "../lib/appearance.js";
import { reportResult } from "../lib/dialogs.js";

const TAG_DEFAULT = "latest";

function section(document, { id, title }) {
  const block = document.createElement("section");
  block.className = "settings-section";
  block.id = id;
  block.setAttribute("data-settings-section", id);
  block.dataset.settingsSection = id;
  const heading = document.createElement("h2");
  heading.className = "settings-section-title";
  heading.textContent = title;
  block.append(heading);
  return block;
}

function helper(document, text) {
  const p = document.createElement("p");
  p.className = "settings-helper";
  p.textContent = text;
  return p;
}

function fieldLabel(document, text, control) {
  const label = document.createElement("label");
  label.className = "settings-field";
  const caption = document.createElement("span");
  caption.className = "settings-field-label";
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

function apiDebugOn(config) {
  return Boolean(config && (config.debugMode === true || config.debug_mode === true));
}

function imageName(config, key, fallback) {
  const value = config?.[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function imageTag(config, key) {
  const value = config?.[key];
  return typeof value === "string" && value.length > 0 ? value : TAG_DEFAULT;
}

function normalizeTag(tag) {
  const trimmed = typeof tag === "string" ? tag.trim() : "";
  return trimmed.length > 0 ? trimmed : TAG_DEFAULT;
}

function imageRef(name, tag) {
  return `${name}:${normalizeTag(tag)}`;
}

/**
 * Build the Settings main pane (grouped sections; no lateral menu).
 * @param {Document} document
 * @param {{
 *   config: object | null,
 *   host: { config: { set: Function }, docker?: { ensureRef?: Function, ensureLevel1?: Function } },
 *   dialogs?: object,
 *   onConfig: (next: object) => void | Promise<void>,
 *   onApiDebugChange: (enabled: boolean) => void | Promise<void>,
 * }} options
 */
export function renderSettingsPage(document, { config, host, dialogs, onConfig, onApiDebugChange }) {
  const root = document.createElement("section");
  root.className = "settings-page";
  root.setAttribute("data-window", "settings");
  root.dataset.window = "settings";

  const header = document.createElement("header");
  header.className = "settings-page-header";
  const title = document.createElement("h1");
  title.textContent = "Settings";
  const version = config?.apiVersion || config?.studio_api_version || "dev";
  const versionEl = document.createElement("p");
  versionEl.className = "settings-page-version";
  versionEl.dataset.studioVersion = version;
  versionEl.setAttribute("aria-label", `Studio build version ${version}`);
  versionEl.textContent = version;
  header.append(title, versionEl);
  root.append(header);

  // Appearance
  const appearance = section(document, { id: "appearance", title: "Appearance" });
  const themeSelect = document.createElement("select");
  themeSelect.setAttribute("aria-label", "Appearance");
  for (const value of ["dark", "light"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "dark" ? "Dark" : "Light";
    themeSelect.append(option);
  }
  themeSelect.value = normalizeAppearance(config?.appearance);
  themeSelect.addEventListener("change", async () => {
    const nextAppearance = normalizeAppearance(themeSelect.value);
    const next = await host.config.set({ appearance: nextAppearance });
    await onConfig(next);
  });
  appearance.append(fieldLabel(document, "Theme", themeSelect));
  root.append(appearance);

  // Privacy
  const privacy = section(document, { id: "privacy", title: "Privacy" });
  privacy.append(
    helper(
      document,
      "When enabled, Studio may send anonymous product usage, feature events, and crash or error signals so we can improve the tool. No bot source code is included.",
    ),
  );
  const plea = document.createElement("aside");
  plea.className = "settings-plea";
  plea.setAttribute("role", "note");
  plea.textContent =
    "Please leave usage data on if you can. It is important to us for improving Studio for every author.";
  privacy.append(plea);

  const telemetryInput = document.createElement("input");
  telemetryInput.type = "checkbox";
  telemetryInput.setAttribute("aria-label", "Send anonymous usage data");
  telemetryInput.checked = config ? config.telemetryEnabled !== false : true;
  telemetryInput.addEventListener("change", async () => {
    const next = await host.config.set({ telemetry_enabled: telemetryInput.checked });
    await onConfig(next);
  });
  const telemetryRow = fieldLabel(document, "Send anonymous usage data", telemetryInput);
  telemetryRow.className = "settings-field settings-field--inline";
  privacy.append(telemetryRow);
  root.append(privacy);

  // Diagnostics
  const diagnostics = section(document, { id: "diagnostics", title: "Diagnostics" });
  const debugInput = document.createElement("input");
  debugInput.type = "checkbox";
  debugInput.setAttribute("aria-label", "Studio API debug logging");
  debugInput.checked = apiDebugOn(config);
  debugInput.addEventListener("change", async () => {
    const next = await host.config.set({ debug_mode: debugInput.checked });
    await onConfig(next);
    await onApiDebugChange(debugInput.checked);
  });
  const debugRow = fieldLabel(document, "Studio API debug logging", debugInput);
  debugRow.className = "settings-field settings-field--inline";
  diagnostics.append(debugRow);
  root.append(diagnostics);

  // Runtime images
  const images = section(document, { id: "runtime-images", title: "Runtime images" });
  const warning = document.createElement("p");
  warning.className = "settings-warning";
  warning.setAttribute("role", "status");
  warning.textContent =
    "Changing these tags can make Studio incompatible with the match runtime or opponent images. Prefer the defaults unless you know you need a different tag.";
  images.append(warning);

  function tagRow({ labelText, nameKey, nameFallback, tagKey, ariaLabel, kind }) {
    const row = document.createElement("div");
    row.className = "settings-tag-row";

    const caption = document.createElement("p");
    caption.className = "settings-field-label";
    caption.textContent = labelText;

    const name = imageName(config, nameKey, nameFallback);
    const refLine = document.createElement("div");
    refLine.className = "settings-image-ref";

    const nameEl = document.createElement("span");
    nameEl.className = "settings-image-name";
    nameEl.textContent = name;

    const colon = document.createElement("span");
    colon.className = "settings-image-colon";
    colon.textContent = ":";
    colon.setAttribute("aria-hidden", "true");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "settings-tag-input";
    input.setAttribute("aria-label", ariaLabel);
    input.value = imageTag(config, tagKey);
    input.spellcheck = false;
    input.autocomplete = "off";

    refLine.append(nameEl, colon, input);

    async function commit(tag) {
      const value = normalizeTag(tag);
      input.value = value;
      const next = await host.config.set({ [tagKey]: value });
      await onConfig(next);
      return value;
    }

    input.addEventListener("change", () => {
      void commit(input.value);
    });

    const actions = document.createElement("div");
    actions.className = "settings-tag-actions";

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "settings-reset";
    reset.textContent = "Reset to default";
    reset.setAttribute("aria-label", `Reset ${ariaLabel} to default`);
    reset.addEventListener("click", () => {
      void commit(TAG_DEFAULT);
    });

    const pull = document.createElement("button");
    pull.type = "button";
    pull.className = "settings-pull";
    pull.textContent = "Check / pull";
    pull.setAttribute("aria-label", `Check or pull ${ariaLabel}`);
    pull.addEventListener("click", async () => {
      const tag = await commit(input.value);
      const ref = imageRef(name, tag);
      pull.disabled = true;
      reset.disabled = true;
      try {
        let result;
        if (kind === "level1" && typeof host.docker?.ensureLevel1 === "function") {
          result = await host.docker.ensureLevel1();
        } else if (typeof host.docker?.ensureRef === "function") {
          result = await host.docker.ensureRef(ref);
        } else {
          result = { ok: false, error: "Image check is not available in this host." };
        }
        if (result?.ok) {
          const body = result.pulled
            ? `Pulled ${result.ref || ref}.`
            : `${result.ref || ref} is already available locally.`;
          dialogs?.notify?.({ title: "Runtime image", body });
        } else if (dialogs) {
          await reportResult(dialogs, result || { ok: false, error: `Could not check ${ref}.` });
        }
      } finally {
        pull.disabled = false;
        reset.disabled = false;
      }
    });

    actions.append(reset, pull);
    row.append(caption, refLine, actions);
    return row;
  }

  images.append(
    tagRow({
      labelText: "Game server image",
      nameKey: "game_server_image",
      nameFallback: "lugobots/server",
      tagKey: "game_server_version",
      ariaLabel: "Game server tag",
      kind: "game_server",
    }),
    tagRow({
      labelText: "Level-1 opponent image",
      nameKey: "bot_level_1_image",
      nameFallback: "lugobots/level-1",
      tagKey: "bot_level_1_version",
      ariaLabel: "Level-1 image tag",
      kind: "level1",
    }),
  );
  root.append(images);

  return root;
}
