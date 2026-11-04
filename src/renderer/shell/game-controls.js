const SPEEDS = ["slow", "normal", "fast"];
const OPPONENTS = ["default", "zombies", "statues", "kids", "defenses"];

function rows() {
  return Array.from({ length: 11 }, () => ({ active: false, running: false, logs: false }));
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

export function initialGameControls() {
  return {
    serverRunning: false,
    home: rows(),
    away: rows(),
    side: "home",
    skipGolden: false,
    speed: "normal",
    opponent: "default",
    positions: [],
  };
}

function copy(state) {
  return {
    serverRunning: state.serverRunning,
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
 * No-op when locked (server running) or when matchSet is unavailable.
 */
export function persistMatchSettings(host, state) {
  if (!host?.config?.matchSet || state.serverRunning) {
    return undefined;
  }
  return host.config.matchSet(matchSettingsPatch(state));
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
    next.opponent = action.opponent;
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
