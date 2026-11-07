export const TABS = [
  {
    id: "workspace",
    label: "Workspace",
    actions: [],
  },
  {
    id: "runtime",
    label: "Runtime",
    actions: [{ id: "image", label: "Studio image" }],
  },
];

export const PINNED = [
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
];

export function tabById(id) {
  return TABS.find((tab) => tab.id === id) || TABS[0];
}

export function menuFor(tabId) {
  const tab = tabById(tabId);
  return {
    tabId: tab.id,
    actions: tab.actions.map((action) => action.id),
    pinned: PINNED.map((item) => item.id),
  };
}
