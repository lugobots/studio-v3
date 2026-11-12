/** Primary shell areas: icon rail destinations with per-area lateral actions. */
export const AREAS = [
  {
    id: "workspace",
    label: "Workspace",
    icon: "code",
    group: "main",
    actions: [],
  },
  {
    id: "build",
    label: "Build",
    icon: "rocket",
    group: "main",
    actions: [],
    placeholder: true,
  },
  {
    id: "help",
    label: "Help",
    icon: "circle-help",
    group: "main",
    actions: [],
    placeholder: true,
  },
  {
    id: "profile",
    label: "Profile",
    icon: "user",
    group: "account",
    actions: [],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    group: "account",
    actions: [],
  },
];

export function areaById(id) {
  return AREAS.find((area) => area.id === id) || AREAS[0];
}

/** @deprecated Prefer areaById; kept for callers that still say "tab". */
export function tabById(id) {
  return areaById(id);
}

/**
 * Lateral menu shape for an area.
 * Profile/Settings are areas on the rail — not pinned onto every menu.
 */
export function menuFor(areaId) {
  const area = areaById(areaId);
  return {
    areaId: area.id,
    tabId: area.id,
    actions: area.actions.map((action) => action.id),
    pinned: [],
  };
}

export function railAreas() {
  return AREAS;
}
