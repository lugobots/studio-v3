import { reportResult } from "../lib/dialogs.js";
import { reduceGameControl } from "./game-controls.js";

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

function controlButton({ title, pressed, className, onClick, graphic, text }) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = title;
  button.setAttribute("title", title);
  button.className = className || "";
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  if (pressed) {
    button.style.borderBottom = "3px solid #60a5f8";
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
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

async function startServerFromApi(state, onChange, host, dialogs) {
  if (!host?.server?.start) {
    return;
  }
  const result = await host.server.start();
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

async function startMatchFromApi(host, dialogs) {
  if (!host?.match?.start) {
    return;
  }
  const result = await host.match.start();
  if (result?.ok) {
    dialogs?.notify?.({ title: "Match started", body: "The match is running." });
    return;
  }
  if (dialogs) {
    await reportResult(dialogs, result || { ok: false, error: "The match failed to start." });
  }
}

export function renderGameControls(parent, { state, onChange, host, dialogs }) {
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
  root.append(server);

  const match = document.createElement("div");
  match.className = "action_block start_stop_buttons game-ctrl-section";
  match.append(heading("Match"));
  match.append(controlButton({
    title: "Starts the match",
    onClick: () => startMatchFromApi(host, dialogs),
    graphic: icon("#22c55e", [["polygon", { points: "8,5 19,12 8,19", fill: "#22c55e", stroke: "#22c55e" }]]),
  }));
  match.append(controlButton({
    title: "Resets the match",
    onClick: () => dispatch(state, onChange, { type: "reset-match" }),
    graphic: icon("#f59e0b", [
      ["path", { d: "M4 12a8 8 0 1 0 2.3-5.7" }],
      ["path", { d: "M4 4v5h5" }],
    ]),
  }));
  root.append(match);

  const play = document.createElement("div");
  play.className = "game-ctrl-play";
  play.style.opacity = state.serverRunning ? "1" : "0.3";
  play.append(teamBlock("home", "Home", state, onChange));
  play.append(teamBlock("away", "Away", state, onChange));
  if (state.home.some((row) => row.logs) || state.away.some((row) => row.logs)) {
    const note = document.createElement("div");
    note.className = "game-ctrl-log-note";
    note.textContent = "Open the terminal on the Editor tab and run logger to watch the logs";
    play.append(note);
  }
  play.append(positionsBlock(state, onChange));
  root.append(play);

  const settings = document.createElement("div");
  settings.className = "game-ctrl-settings";
  settings.style.opacity = state.serverRunning ? "0.2" : "1";
  settings.append(configBlock(state, onChange));
  settings.append(choiceBlock("Game speed", SPEEDS, state.speed, (id) => dispatch(state, onChange, { type: "set-speed", speed: id })));
  settings.append(choiceBlock("Opponent mode", OPPONENTS, state.opponent, (id) => dispatch(state, onChange, { type: "set-opponent", opponent: id })));
  root.append(settings);

  parent.append(root);
  return root;
}

function teamBlock(team, label, state, onChange) {
  const block = document.createElement("div");
  block.className = "bot_actions";
  block.append(heading(label));
  const list = document.createElement("div");
  state[team].forEach((row, index) => {
    const line = document.createElement("div");
    line.className = "bot_action_buttons";
    line.dataset.running = String(row.running);
    line.dataset.logs = String(row.logs);
    const number = document.createElement("span");
    number.className = "bot-number";
    number.textContent = String(index + 1);
    const player = index + 1;
    line.append(
      number,
      controlButton({
        title: "Start",
        text: "🟢",
        className: row.running ? "is-running" : "",
        onClick: () => dispatch(state, onChange, { type: "set-bot", team, number: player, control: "start" }),
      }),
      controlButton({
        title: "Kill",
        text: "💀",
        onClick: () => dispatch(state, onChange, { type: "set-bot", team, number: player, control: "kill" }),
      }),
      controlButton({
        title: "Ver logs",
        text: row.logs ? "X" : "📄",
        onClick: () => dispatch(state, onChange, { type: "set-bot", team, number: player, control: "logs" }),
      }),
    );
    list.append(line);
  });
  block.append(list);
  return block;
}

function positionsBlock(state, onChange) {
  const section = document.createElement("div");
  section.className = "action_block game-ctrl-section game-ctrl-positions";
  section.append(heading("Positions"));
  const set = document.createElement("div");
  set.className = "position_set";
  set.append(controlButton({
    title: "Save positions",
    className: "position-btn position-btn-save",
    text: "Save positions",
    onClick: () => dispatch(state, onChange, { type: "save-positions" }),
  }));
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Positions");
  for (const name of state.positions) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  set.append(select);
  set.append(controlButton({
    title: "Apply",
    className: "position-btn position-btn-apply",
    text: "Apply",
    onClick: () => dispatch(state, onChange, { type: "apply-positions" }),
  }));
  section.append(set);
  return section;
}

function configBlock(state, onChange) {
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
  side.addEventListener("click", () => dispatch(state, onChange, { type: "toggle-side" }));
  sideRow.append(side);

  const goldenRow = document.createElement("div");
  goldenRow.className = "game-ctrl-row";
  const golden = document.createElement("label");
  golden.id = "extra-time-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = state.skipGolden;
  input.addEventListener("change", () => dispatch(state, onChange, { type: "toggle-golden" }));
  golden.append(input, document.createTextNode(" Skip to Golden Goal"));
  goldenRow.append(golden);
  wrap.append(title, sideRow, goldenRow);
  return wrap;
}

function choiceBlock(label, choices, selected, onPick) {
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
      onClick: () => onPick(choice.id),
      graphic: icon(choice.color, [["circle", { cx: "12", cy: "12", r: "6" }]]),
    }));
  }
  wrap.append(title, row);
  return wrap;
}
