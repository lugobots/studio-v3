import { reportResult } from "../lib/dialogs.js";
import {
  activeBotSlots,
  applyMatchConfig,
  findPositionPreset,
  markActiveBotsRunning,
  matchSettingsForApi,
  persistBotActiveSettings,
  persistMatchSettings,
  reduceGameControl,
  upsertPositionPreset,
} from "./game-controls.js";

const SVG = "http://www.w3.org/2000/svg";

const SPEEDS = [
  { id: "slow", title: "Slow speed", color: "#60a5fa" },
  { id: "normal", title: "Normal Speed", color: "#22c55e" },
  { id: "fast", title: "Fast speed", color: "#f59e0b" },
];

const OPPONENTS = [
  { id: "default", title: "Normal game", color: "#60a5fa" },
  { id: "zombies", title: "Zombies mode", color: "#ef4444" },
  { id: "statues", title: "Statues mode", color: "#a78bfa" },
  { id: "kids", title: "Kids mode", color: "#22c55e" },
  { id: "defenses", title: "Defensing mode", color: "#f59e0b" },
];

function icon(color, parts) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    if (!node.getAttribute("stroke")) {
      node.setAttribute("stroke", color);
    }
    if (!node.getAttribute("fill")) {
      node.setAttribute("fill", "none");
    }
    node.setAttribute("stroke-width", node.getAttribute("stroke-width") || "2");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    svg.append(node);
  }
  return svg;
}

function heading(text) {
  const title = document.createElement("h3");
  title.textContent = text;
  return title;
}

function controlButton({ title, pressed, className, onClick, graphic, text, disabled = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = title;
  button.setAttribute("title", title);
  button.className = className || "";
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.disabled = Boolean(disabled);
  if (disabled) {
    button.setAttribute("disabled", "true");
    button.setAttribute("aria-disabled", "true");
  }
  if (pressed) {
    button.style.borderBottom = "3px solid #60a5f8";
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (button.disabled) {
      return;
    }
    onClick();
  });
  if (graphic) {
    button.append(graphic);
  } else {
    button.textContent = text;
  }
  return button;
}

function dispatch(state, onChange, action) {
  onChange(reduceGameControl(state, action));
}

/** Selection-state change for Config / speed / opponent; persists only while server is down. */
function dispatchSettings(state, onChange, host, action) {
  if (state.serverRunning) {
    return;
  }
  const next = reduceGameControl(state, action);
  onChange(next);
  void persistMatchSettings(host, next);
}

export async function startServerFromApi(state, onChange, host, dialogs) {
  if (!host?.server?.start) {
    return;
  }
  // Flush app settings first; still pass live UI prefs so start does not race a pending write.
  await persistMatchSettings(host, state);
  const result = await host.server.start(matchSettingsForApi(state));
  if (result?.ok) {
    dispatch(state, onChange, { type: "set-server-running", running: true });
    return;
  }
  if (dialogs) {
    await reportResult(dialogs, result || { ok: false, error: "The game server failed to start." });
  }
}

async function stopServerFromApi(state, onChange, host, dialogs) {
  if (!host?.server?.stop || !dialogs?.confirm) {
    return;
  }
  const accepted = await dialogs.confirm({
    title: "Stop the Game Server?",
    body: "The game server will stop. You can start it again when you are ready.",
    confirmLabel: "Stop",
    cancelLabel: "Cancel",
  });
  if (!accepted) {
    return;
  }
  const result = await host.server.stop();
  if (result?.ok) {
    dispatch(state, onChange, { type: "set-server-running", running: false });
    return;
  }
  await reportResult(dialogs, result || { ok: false, error: "The game server failed to stop." });
}

async function startMatchFromApi(state, onChange, host, dialogs) {
  if (!host?.match?.start) {
    return;
  }
  const result = await host.match.start({ active: activeBotSlots(state) });
  if (result?.ok) {
    onChange(markActiveBotsRunning(state));
    dialogs?.notify?.({ title: "Match started", body: "The match is running." });
    return;
  }
  if (dialogs) {
    await reportResult(dialogs, result || { ok: false, error: "The match failed to start." });
  }
}

async function resetMatchFromApi(state, host, dialogs) {
  if (!state.serverRunning || !host?.match?.reset) {
    return;
  }
  const result = await host.match.reset();
  if (result?.ok) {
    dialogs?.notify?.({ title: "Match reset", body: "Player positions were reset." });
    return;
  }
  if (dialogs) {
    await reportResult(dialogs, result || { ok: false, error: "The match failed to reset." });
  }
}

async function savePositionsFromApi(state, onChange, host, dialogs) {
  if (
    !state.serverRunning
    || !host?.match?.getPositions
    || !host?.config?.matchGet
    || !host?.config?.matchSet
  ) {
    return;
  }
  const rawName = typeof globalThis.prompt === "function" ? globalThis.prompt("Pick a name:") : null;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) {
    return;
  }
  const snapshotResult = await host.match.getPositions();
  if (!snapshotResult?.ok) {
    if (dialogs) {
      await reportResult(
        dialogs,
        snapshotResult || { ok: false, error: "Failed to read current positions." },
      );
    }
    return;
  }
  let match;
  try {
    match = await host.config.matchGet();
  } catch (error) {
    if (dialogs) {
      await reportResult(dialogs, { ok: false, error: error.message || "Failed to load match settings." });
    }
    return;
  }
  const saved = upsertPositionPreset(match?.saved_positions, name, snapshotResult.body);
  try {
    const written = await host.config.matchSet({ saved_positions: saved });
    onChange(applyMatchConfig(state, written || { ...match, saved_positions: saved }));
    dialogs?.notify?.({ title: "Positions saved", body: `Saved "${name}".` });
  } catch (error) {
    if (dialogs) {
      await reportResult(dialogs, { ok: false, error: error.message || "Failed to save positions." });
    }
  }
}

async function applyPositionsFromApi(state, host, dialogs, selectedName) {
  if (!state.serverRunning || !host?.match?.applyPositions || !host?.config?.matchGet) {
    return;
  }
  if (!selectedName) {
    return;
  }
  let match;
  try {
    match = await host.config.matchGet();
  } catch (error) {
    if (dialogs) {
      await reportResult(dialogs, { ok: false, error: error.message || "Failed to load match settings." });
    }
    return;
  }
  const snapshot = findPositionPreset(match?.saved_positions, selectedName);
  if (!snapshot) {
    return;
  }
  const result = await host.match.applyPositions(snapshot);
  if (result?.ok) {
    dialogs?.notify?.({ title: "Positions applied", body: `Applied "${selectedName}".` });
    return;
  }
  if (dialogs) {
    await reportResult(dialogs, result || { ok: false, error: "Failed to apply positions." });
  }
}

async function toggleBotActive(state, onChange, host, dialogs, team, number) {
  const index = Number(number) - 1;
  const row = state[team]?.[index];
  if (!row) {
    return;
  }
  const nextActive = !row.active;
  const next = reduceGameControl(state, {
    type: "set-bot",
    team,
    number,
    control: "active",
    active: nextActive,
  });
  onChange(next);
  persistBotActiveSettings(host, next);

  if (!state.serverRunning) {
    return;
  }

  const side = team.toUpperCase();
  if (nextActive) {
    if (row.running || !host?.bot?.start) {
      return;
    }
    const result = await host.bot.start({ side, number });
    if (result?.ok) {
      onChange(reduceGameControl(next, {
        type: "set-bot",
        team,
        number,
        control: "running",
        running: true,
      }));
      return;
    }
    if (dialogs) {
      await reportResult(dialogs, result || { ok: false, error: "The bot failed to start." });
    }
    return;
  }

  if (!row.running || !host?.bot?.stop) {
    return;
  }
  const result = await host.bot.stop({ side, number });
  if (result?.ok) {
    onChange(reduceGameControl(next, {
      type: "set-bot",
      team,
      number,
      control: "running",
      running: false,
    }));
    return;
  }
  if (dialogs) {
    await reportResult(dialogs, result || { ok: false, error: "The bot failed to stop." });
  }
}

async function toggleServerLogs(state, onChange, host) {
  const nextOn = !state.serverLogs;
  onChange(reduceGameControl(state, { type: "toggle-server-logs" }));
  if (nextOn) {
    if (typeof host?.logs?.arm === "function") {
      await host.logs.arm("server");
    }
    return;
  }
  if (typeof host?.logs?.disarm === "function") {
    await host.logs.disarm("server");
  }
}

async function toggleBotLogs(state, onChange, host, team, number, onOpenLogs) {
  const index = Number(number) - 1;
  const row = state[team]?.[index];
  if (!row) {
    return;
  }
  const nextOn = !row.logs;
  const next = reduceGameControl(state, {
    type: "set-bot",
    team,
    number,
    control: "logs",
  });
  onChange(next);
  const source = `${team}/${number}`;
  if (nextOn) {
    if (typeof host?.logs?.arm === "function") {
      await host.logs.arm(source);
    }
    onOpenLogs?.(source);
    return;
  }
  if (typeof host?.logs?.disarm === "function") {
    await host.logs.disarm(source);
  }
}

export function renderGameControls(parent, { state, onChange, host, dialogs, onOpenLogs }) {
  const root = document.createElement("div");
  root.className = "game-ctrl";

  const server = document.createElement("div");
  server.className = "action_block start_stop_buttons game-ctrl-section";
  server.append(heading("Server"));
  const serverTitle = state.serverRunning ? "Stops the Game Server" : "Starts the Game Server";
  const serverColor = state.serverRunning ? "#22c55e" : "#ef4444";
  server.append(controlButton({
    title: serverTitle,
    className: state.serverRunning ? "server-power is-running" : "server-power",
    onClick: () => {
      if (state.serverRunning) {
        stopServerFromApi(state, onChange, host, dialogs);
        return;
      }
      startServerFromApi(state, onChange, host, dialogs);
    },
    graphic: icon(serverColor, [
      ["path", { d: "M12 3v6" }],
      ["path", { d: "M7 7.5a6.5 6.5 0 1 0 10 0" }],
    ]),
  }));
  server.append(controlButton({
    title: "Server logs",
    pressed: Boolean(state.serverLogs),
    text: state.serverLogs ? "X" : "📄",
    onClick: () => {
      void toggleServerLogs(state, onChange, host);
    },
  }));
  root.append(server);

  const playLocked = !state.serverRunning;

  const match = document.createElement("div");
  match.className = "action_block start_stop_buttons game-ctrl-section";
  match.append(heading("Match"));
  match.append(controlButton({
    title: "Starts the match",
    disabled: playLocked,
    onClick: () => startMatchFromApi(state, onChange, host, dialogs),
    graphic: icon("#22c55e", [["polygon", { points: "8,5 19,12 8,19", fill: "#22c55e", stroke: "#22c55e" }]]),
  }));
  match.append(controlButton({
    title: "Resets the match",
    disabled: playLocked,
    onClick: () => resetMatchFromApi(state, host, dialogs),
    graphic: icon("#f59e0b", [
      ["path", { d: "M4 12a8 8 0 1 0 2.3-5.7" }],
      ["path", { d: "M4 4v5h5" }],
    ]),
  }));
  root.append(match);

  const play = document.createElement("div");
  play.className = "game-ctrl-play";
  play.style.opacity = state.serverRunning ? "1" : "0.3";
  play.append(teamBlock("home", "Home", state, onChange, host, dialogs, onOpenLogs));
  play.append(teamBlock("away", "Away", state, onChange, host, dialogs, onOpenLogs));
  play.append(positionsBlock(state, onChange, host, dialogs, playLocked));
  root.append(play);

  const settings = document.createElement("div");
  settings.className = "game-ctrl-settings";
  settings.style.opacity = state.serverRunning ? "0.2" : "1";
  const settingsLocked = Boolean(state.serverRunning);
  settings.append(configBlock(state, onChange, host, settingsLocked));
  settings.append(choiceBlock(
    "Game speed",
    SPEEDS,
    state.speed,
    (id) => dispatchSettings(state, onChange, host, { type: "set-speed", speed: id }),
    settingsLocked,
  ));
  settings.append(choiceBlock(
    "Opponent mode",
    OPPONENTS,
    state.opponent,
    (id) => dispatchSettings(state, onChange, host, { type: "set-opponent", opponent: id }),
    settingsLocked,
  ));
  root.append(settings);

  parent.append(root);
  return root;
}

function teamBlock(team, label, state, onChange, host, dialogs, onOpenLogs) {
  const block = document.createElement("div");
  block.className = "bot_actions";
  block.append(heading(label));
  const list = document.createElement("div");
  state[team].forEach((row, index) => {
    const line = document.createElement("div");
    line.className = "bot_action_buttons";
    line.dataset.active = String(Boolean(row.active));
    line.dataset.running = String(Boolean(row.running));
    line.dataset.logs = String(row.logs);
    const number = document.createElement("span");
    number.className = "bot-number";
    number.textContent = String(index + 1);
    const player = index + 1;
    const activeClasses = [
      "bot-active-switch",
      row.active ? "is-active" : "",
      row.running ? "is-running" : "",
    ].filter(Boolean).join(" ");
    line.append(
      number,
      controlButton({
        title: "Active",
        pressed: Boolean(row.active),
        text: row.running ? "🟢" : (row.active ? "○" : "·"),
        className: activeClasses,
        onClick: () => toggleBotActive(state, onChange, host, dialogs, team, player),
      }),
      controlButton({
        title: "Ver logs",
        text: row.logs ? "X" : "📄",
        onClick: () => {
          void toggleBotLogs(state, onChange, host, team, player, onOpenLogs);
        },
      }),
    );
    list.append(line);
  });
  block.append(list);
  return block;
}

function positionsBlock(state, onChange, host, dialogs, disabled = false) {
  const section = document.createElement("div");
  section.className = "action_block game-ctrl-section game-ctrl-positions";
  section.append(heading("Positions"));
  const set = document.createElement("div");
  set.className = "position_set";
  set.append(controlButton({
    title: "Save positions",
    className: "position-btn position-btn-save",
    text: "Save positions",
    disabled,
    onClick: () => savePositionsFromApi(state, onChange, host, dialogs),
  }));
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Positions");
  select.disabled = Boolean(disabled);
  if (disabled) {
    select.setAttribute("disabled", "true");
    select.setAttribute("aria-disabled", "true");
  }
  for (const name of state.positions) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  if (state.positions.length) {
    select.value = state.positions[0];
  }
  set.append(select);
  set.append(controlButton({
    title: "Apply",
    className: "position-btn position-btn-apply",
    text: "Apply",
    disabled,
    onClick: () => applyPositionsFromApi(state, host, dialogs, select.value),
  }));
  section.append(set);
  return section;
}

function configBlock(state, onChange, host, disabled = false) {
  const wrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "game-ctrl-section-title";
  title.append(heading("Config"));
  const sideRow = document.createElement("div");
  sideRow.className = "game-ctrl-row";
  const side = document.createElement("div");
  side.id = "team-side-switch";
  side.setAttribute("role", "switch");
  side.setAttribute("aria-checked", state.side === "away" ? "true" : "false");
  side.setAttribute("aria-label", "Team side");
  side.setAttribute("aria-disabled", disabled ? "true" : "false");
  if (disabled) {
    side.style.pointerEvents = "none";
  }
  const caption = document.createElement("span");
  caption.textContent = "Team side:";
  const track = document.createElement("span");
  track.className = "side-switch-track";
  track.dataset.side = state.side;
  const knob = document.createElement("span");
  knob.className = "side-switch-knob";
  knob.textContent = state.side === "away" ? "Away" : "Home";
  track.append(knob);
  side.append(caption, track);
  side.addEventListener("click", () => {
    if (disabled) {
      return;
    }
    dispatchSettings(state, onChange, host, { type: "toggle-side" });
  });
  sideRow.append(side);

  const goldenRow = document.createElement("div");
  goldenRow.className = "game-ctrl-row";
  const golden = document.createElement("label");
  golden.id = "extra-time-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = state.skipGolden;
  input.disabled = Boolean(disabled);
  if (disabled) {
    input.setAttribute("disabled", "true");
    input.setAttribute("aria-disabled", "true");
  }
  input.addEventListener("change", () => {
    if (input.disabled || disabled) {
      return;
    }
    dispatchSettings(state, onChange, host, { type: "toggle-golden" });
  });
  golden.append(input, document.createTextNode(" Skip to Golden Goal"));
  goldenRow.append(golden);
  wrap.append(title, sideRow, goldenRow);
  return wrap;
}

function choiceBlock(label, choices, selected, onPick, disabled = false) {
  const wrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "game-ctrl-section-title";
  title.append(heading(label));
  const row = document.createElement("div");
  row.className = "action_block start_stop_buttons game-ctrl-section";
  for (const choice of choices) {
    row.append(controlButton({
      title: choice.title,
      pressed: choice.id === selected,
      disabled,
      onClick: () => onPick(choice.id),
      graphic: icon(choice.color, [["circle", { cx: "12", cy: "12", r: "6" }]]),
    }));
  }
  wrap.append(title, row);
  return wrap;
}
