const SPEEDS = ["slow", "normal", "fast"];
const OPPONENTS = ["default", "zombies", "statues", "kids", "defenses"];

function rows() {
  return Array.from({ length: 11 }, () => ({ running: false, logs: false }));
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
    home: state.home.map((row) => ({ running: row.running, logs: row.logs })),
    away: state.away.map((row) => ({ running: row.running, logs: row.logs })),
    side: state.side,
    skipGolden: state.skipGolden,
    speed: state.speed,
    opponent: state.opponent,
    positions: state.positions.slice(),
  };
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

  if (action.type === "set-bot") {
    const team = action.team === "away" ? "away" : "home";
    const index = Number(action.number) - 1;
    const row = next[team][index];
    if (!row) {
      return next;
    }
    if (action.control === "start") {
      row.running = true;
    } else if (action.control === "kill") {
      row.running = false;
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
