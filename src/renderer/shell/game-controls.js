const SPEEDS = ["slow", "normal", "fast"];
const OPPONENTS = ["default", "zombies", "statues", "kids", "defenses"];
const OPPONENT_SOURCES = ["level1", "local"];
const BOT_ROSTER_SIZE = 11;

function rows() {
  // Default all roster slots on so “Starts the match” launches a full 11v11
  // unless the author toggles rows off.
  return Array.from({ length: BOT_ROSTER_SIZE }, () => ({ active: true, running: false, logs: false }));
}

/** Desired-active flags for one team from game-control rows. */
function botsActiveFromRows(teamRows) {
  const rowsForTeam = Array.isArray(teamRows) ? teamRows : [];
  return Array.from({ length: BOT_ROSTER_SIZE }, (_, index) => Boolean(rowsForTeam[index]?.active));
}

function positionNames(saved) {
  if (!Array.isArray(saved)) {
    return [];
  }
  return saved
    .map((entry) => {
      if (typeof entry === "string" && entry) {
        return entry;
      }
      if (entry && typeof entry.name === "string" && entry.name) {
        return entry.name;
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeOpponentProjects(projects) {
  if (!Array.isArray(projects)) {
    return [];
  }
  return projects
    .filter((entry) => entry && typeof entry.label === "string" && typeof entry.path === "string")
    .map((entry) => ({ label: entry.label, path: entry.path }));
}

export function initialGameControls() {
  return {
    serverRunning: false,
    serverLogs: false,
    home: rows(),
    away: rows(),
    side: "home",
    skipGolden: false,
    speed: "normal",
    opponent: "default",
    opponentSource: "level1",
    opponentProjects: [],
    opponentProjectPath: "",
    positions: [],
  };
}

function copy(state) {
  return {
    serverRunning: state.serverRunning,
    serverLogs: Boolean(state.serverLogs),
    home: state.home.map((row) => ({
      active: Boolean(row.active),
      running: Boolean(row.running),
      logs: Boolean(row.logs),
    })),
    away: state.away.map((row) => ({
      active: Boolean(row.active),
      running: Boolean(row.running),
      logs: Boolean(row.logs),
    })),
    side: state.side,
    skipGolden: state.skipGolden,
    speed: state.speed,
    opponent: state.opponent,
    opponentSource: state.opponentSource === "local" ? "local" : "level1",
    opponentProjects: normalizeOpponentProjects(state.opponentProjects),
    opponentProjectPath: typeof state.opponentProjectPath === "string" ? state.opponentProjectPath : "",
    positions: state.positions.slice(),
  };
}

/**
 * Apply app-level match prefs (user.json shape) onto game-control selection state.
 * Pure — callers (frame / host adapters) own IPC load.
 */
export function applyMatchConfig(state, match) {
  const next = copy(state);
  if (!match || typeof match !== "object") {
    return next;
  }
  if (match.team_side === "home" || match.team_side === "away") {
    next.side = match.team_side;
  }
  if (typeof match.skip_to_golden_goal === "boolean") {
    next.skipGolden = match.skip_to_golden_goal;
  }
  if (SPEEDS.includes(match.game_speed)) {
    next.speed = match.game_speed;
  }
  if (OPPONENTS.includes(match.opponent_team)) {
    next.opponent = match.opponent_team;
  }
  if (Object.prototype.hasOwnProperty.call(match, "saved_positions")) {
    next.positions = positionNames(match.saved_positions);
  }
  // Desired-active is session-only; ignore legacy home_bots_active / away_bots_active.
  return next;
}

/**
 * Apply opponent source prefs from opponentGet / config.get onto selection state.
 * Prefers effective_source so invalid local paths render as Level-1.
 */
export function applyOpponentSourceConfig(state, opponent) {
  const next = copy(state);
  if (!opponent || typeof opponent !== "object") {
    return next;
  }
  const effective = opponent.effective_source
    || opponent.effective_opponent_source
    || opponent.opponent_source;
  if (OPPONENT_SOURCES.includes(effective)) {
    next.opponentSource = effective;
  }
  if (Object.prototype.hasOwnProperty.call(opponent, "opponent_projects")) {
    next.opponentProjects = normalizeOpponentProjects(opponent.opponent_projects);
  }
  const storedPath = typeof opponent.opponent_project_path === "string"
    ? opponent.opponent_project_path
    : "";
  const effectivePath = opponent.effective_project_path
    || opponent.effective_opponent_project_path
    || "";
  if (next.opponentSource === "local" && typeof effectivePath === "string" && effectivePath) {
    next.opponentProjectPath = effectivePath;
  } else if (typeof storedPath === "string") {
    next.opponentProjectPath = storedPath;
  }
  return next;
}

/** Patch for config.matchSet from current selection state (no position snapshots). */
export function matchSettingsPatch(state) {
  return {
    team_side: state.side,
    skip_to_golden_goal: Boolean(state.skipGolden),
    game_speed: state.speed,
    opponent_team: state.opponent,
  };
}

/** Patch with only Home/Away desired-active arrays (safe while the server is running). */
export function botActiveSettingsPatch(state) {
  return {
    home_bots_active: botsActiveFromRows(state.home),
    away_bots_active: botsActiveFromRows(state.away),
  };
}

/** Match prefs shaped for Studio API server/match/bot start bodies. */
export function matchSettingsForApi(state) {
  return {
    team_side: state.side,
    skip_to_golden_goal: Boolean(state.skipGolden),
    game_speed: state.speed,
    opponent_mode: state.opponent,
  };
}

/** Upsert a named position snapshot into the app-level saved_positions list. */
export function upsertPositionPreset(savedPositions, name, snapshot) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || !snapshot || typeof snapshot !== "object") {
    return Array.isArray(savedPositions) ? savedPositions.slice() : [];
  }
  const entry = {
    name: trimmed,
    ball: snapshot.ball,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
  };
  const list = Array.isArray(savedPositions) ? savedPositions.slice() : [];
  const index = list.findIndex((item) => item && item.name === trimmed);
  if (index >= 0) {
    list[index] = entry;
  } else {
    list.push(entry);
  }
  return list;
}

/** Snapshot payload for apply (ball/homeTeam/awayTeam) from a named preset. */
export function findPositionPreset(savedPositions, name) {
  if (!name || !Array.isArray(savedPositions)) {
    return null;
  }
  const found = savedPositions.find((item) => item && item.name === name);
  if (!found || typeof found !== "object") {
    return null;
  }
  return {
    ball: found.ball,
    homeTeam: found.homeTeam,
    awayTeam: found.awayTeam,
  };
}

/**
 * Persist Config / speed / opponent while the server is down.
 * Opponent mode is written only when source is Level-1.
 * No-op when locked (server running) or when matchSet is unavailable.
 */
export function persistMatchSettings(host, state) {
  if (!host?.config?.matchSet || state.serverRunning) {
    return undefined;
  }
  const patch = matchSettingsPatch(state);
  if (state.opponentSource === "local") {
    delete patch.opponent_team;
  }
  return host.config.matchSet(patch);
}

/**
 * Desired-active is session-only and must not be written to user.json.
 * Kept as a no-op so callers can drop persistence without changing toggle flow.
 */
export function persistBotActiveSettings() {
  return undefined;
}

/** Force every Home/Away row desired-active enabled (used when the game server starts). */
export function enableAllBotsActive(state) {
  const next = copy(state);
  next.home = (next.home || []).map((row) => ({ ...row, active: true }));
  next.away = (next.away || []).map((row) => ({ ...row, active: true }));
  return next;
}

/** Active rows as match-start IPC slots (HOME/AWAY + number). */
export function activeBotSlots(state) {
  const slots = [];
  for (const team of ["home", "away"]) {
    const rowsForTeam = state[team] || [];
    for (let index = 0; index < rowsForTeam.length; index += 1) {
      if (rowsForTeam[index]?.active) {
        slots.push({ side: team.toUpperCase(), number: index + 1 });
      }
    }
  }
  return slots;
}

/** After a successful match start, mark desired-active rows as running. */
export function markActiveBotsRunning(state) {
  const next = copy(state);
  for (const team of ["home", "away"]) {
    for (const row of next[team]) {
      if (row.active) {
        row.running = true;
      }
    }
  }
  return next;
}

export function reduceGameControl(state, action) {
  const next = copy(state);
  if (!action || typeof action.type !== "string") {
    return next;
  }

  if (action.type === "toggle-server") {
    next.serverRunning = !state.serverRunning;
    return next;
  }

  if (action.type === "set-server-running") {
    next.serverRunning = Boolean(action.running);
    if (next.serverRunning) {
      next.home = next.home.map((row) => ({ ...row, active: true }));
      next.away = next.away.map((row) => ({ ...row, active: true }));
    }
    return next;
  }

  if (action.type === "enable-all-bots") {
    next.home = next.home.map((row) => ({ ...row, active: true }));
    next.away = next.away.map((row) => ({ ...row, active: true }));
    return next;
  }

  if (action.type === "toggle-server-logs") {
    next.serverLogs = !state.serverLogs;
    return next;
  }

  if (action.type === "set-bot") {
    const team = action.team === "away" ? "away" : "home";
    const index = Number(action.number) - 1;
    const row = next[team][index];
    if (!row) {
      return next;
    }
    if (action.control === "active") {
      row.active = Object.prototype.hasOwnProperty.call(action, "active")
        ? Boolean(action.active)
        : !row.active;
    } else if (action.control === "running") {
      row.running = Boolean(action.running);
    } else if (action.control === "logs") {
      row.logs = !row.logs;
    }
    return next;
  }

  if (action.type === "set-speed" && SPEEDS.includes(action.speed)) {
    next.speed = action.speed;
    return next;
  }

  if (action.type === "set-opponent" && OPPONENTS.includes(action.opponent)) {
    if (next.opponentSource === "local") {
      return next;
    }
    next.opponent = action.opponent;
    return next;
  }

  if (action.type === "set-opponent-source" && OPPONENT_SOURCES.includes(action.source)) {
    next.opponentSource = action.source;
    if (typeof action.path === "string") {
      next.opponentProjectPath = action.path;
    } else if (action.source === "level1") {
      // Keep stored path when switching back to Level-1 so labeled list stays intact.
    }
    return next;
  }

  if (action.type === "set-opponent-projects") {
    next.opponentProjects = normalizeOpponentProjects(action.projects);
    return next;
  }

  if (action.type === "toggle-side") {
    next.side = state.side === "away" ? "home" : "away";
    return next;
  }

  if (action.type === "toggle-golden") {
    next.skipGolden = !state.skipGolden;
    return next;
  }

  return next;
}
