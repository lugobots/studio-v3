/**
 * Profile main pane: Doorway sign-in / identity / live bots / logout.
 * @param {Document} document
 * @param {{
 *   account: { signedIn?: boolean, profile?: object | null } | null,
 *   bots?: {
 *     status?: "idle" | "loading" | "ready" | "empty" | "error",
 *     items?: Array<{
 *       name?: string,
 *       uri?: string,
 *       avatarUrl?: string | null,
 *       category?: string,
 *       pageUrl?: string,
 *       manageUrl?: string,
 *       badge?: string,
 *       star?: boolean,
 *       starTooltip?: string,
 *     }>,
 *     error?: string | null,
 *   } | null,
 *   busy?: boolean,
 *   onSignIn: () => void | Promise<void>,
 *   onSignOut: () => void | Promise<void>,
 *   onOpenExternal?: (url: string) => void | Promise<void>,
 * }} options
 */
export function renderProfilePage(
  document,
  {
    account,
    bots = null,
    busy = false,
    onSignIn,
    onSignOut,
    onOpenExternal = null,
  },
) {
  const root = document.createElement("section");
  root.className = "profile-page";
  root.setAttribute("data-window", "profile");
  root.dataset.window = "profile";

  const header = document.createElement("header");
  header.className = "profile-page-header";
  const title = document.createElement("h1");
  title.textContent = "Profile";
  header.append(title);
  root.append(header);

  const signedIn = Boolean(account?.signedIn && account?.profile);
  if (!signedIn) {
    const panel = document.createElement("section");
    panel.className = "profile-section";
    panel.setAttribute("data-profile-section", "sign-in");
    const copy = document.createElement("p");
    copy.className = "profile-helper";
    copy.textContent = "Connect your Lugo Bots account to show your name and avatar in Studio.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-action profile-action--primary";
    button.textContent = busy ? "Signing in…" : "Sign in with Doorway";
    button.disabled = Boolean(busy);
    button.addEventListener("click", () => {
      void onSignIn();
    });
    panel.append(copy, button);
    root.append(panel);
    return root;
  }

  const profile = account.profile;
  const identity = document.createElement("section");
  identity.className = "profile-section";
  identity.setAttribute("data-profile-section", "identity");

  const row = document.createElement("div");
  row.className = "profile-identity";
  if (profile.avatarUrl) {
    const img = document.createElement("img");
    img.className = "profile-avatar";
    img.src = profile.avatarUrl;
    img.alt = "";
    img.width = 64;
    img.height = 64;
    row.append(img);
  }
  const meta = document.createElement("div");
  meta.className = "profile-identity-meta";
  const name = document.createElement("p");
  name.className = "profile-name";
  name.textContent = profile.name || "Signed in";
  const username = document.createElement("p");
  username.className = "profile-username";
  username.textContent = profile.username ? `@${profile.username}` : "";
  meta.append(name, username);
  row.append(meta);
  identity.append(row);
  root.append(identity);

  root.append(renderBotsSection(document, bots, onOpenExternal));

  const session = document.createElement("section");
  session.className = "profile-section";
  session.setAttribute("data-profile-section", "session");
  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "profile-action";
  logout.textContent = busy ? "Signing out…" : "Log out";
  logout.disabled = Boolean(busy);
  logout.addEventListener("click", () => {
    void onSignOut();
  });
  session.append(logout);
  root.append(session);

  return root;
}

/**
 * @param {Document} document
 * @param {{
 *   status?: string,
 *   items?: Array<object>,
 *   error?: string | null,
 * } | null} bots
 * @param {((url: string) => void | Promise<void>) | null} onOpenExternal
 */
function renderBotsSection(document, bots, onOpenExternal) {
  const section = document.createElement("section");
  section.className = "profile-section";
  section.setAttribute("data-profile-section", "bots");

  const botsTitle = document.createElement("h2");
  botsTitle.className = "profile-section-title";
  botsTitle.textContent = "Bots";
  section.append(botsTitle);

  const status = bots?.status || "idle";
  section.setAttribute("data-bots-state", status === "idle" ? "loading" : status);

  if (status === "loading" || status === "idle") {
    const note = document.createElement("p");
    note.className = "profile-helper";
    note.textContent = "Loading bots…";
    section.append(note);
    return section;
  }

  if (status === "error") {
    const note = document.createElement("p");
    note.className = "profile-helper profile-helper--error";
    note.textContent = bots?.error
      ? `Could not load bots (${bots.error}).`
      : "Could not load bots.";
    section.append(note);
    return section;
  }

  if (status === "empty" || !(bots?.items?.length > 0)) {
    section.setAttribute("data-bots-state", "empty");
    const note = document.createElement("p");
    note.className = "profile-helper";
    note.textContent = "No bots on this account yet.";
    section.append(note);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "profile-bot-list";
  for (const bot of bots.items) {
    list.append(renderBotRow(document, bot, onOpenExternal));
  }
  section.append(list);
  return section;
}

/**
 * @param {Document} document
 * @param {object} bot
 * @param {((url: string) => void | Promise<void>) | null} onOpenExternal
 */
function renderBotRow(document, bot, onOpenExternal) {
  const item = document.createElement("li");
  item.className = "profile-bot-item";

  const avatarWrap = document.createElement("div");
  avatarWrap.className = "profile-bot-avatar-wrap";
  if (bot.avatarUrl) {
    const img = document.createElement("img");
    img.className = "profile-bot-avatar";
    img.src = bot.avatarUrl;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    avatarWrap.append(img);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "profile-bot-avatar profile-bot-avatar--empty";
    avatarWrap.append(placeholder);
  }
  if (bot.star) {
    const star = document.createElement("span");
    star.className = "profile-bot-star";
    star.setAttribute("aria-label", bot.starTooltip || "Tournament winner");
    if (bot.starTooltip) {
      star.title = bot.starTooltip;
    }
    star.textContent = "★";
    avatarWrap.append(star);
  }

  const body = document.createElement("div");
  body.className = "profile-bot-body";
  const botName = document.createElement("span");
  botName.className = "profile-bot-name";
  botName.textContent = bot.name || bot.uri || "Bot";
  const botUri = document.createElement("span");
  botUri.className = "profile-bot-uri";
  botUri.textContent = bot.uri || "";
  const meta = document.createElement("div");
  meta.className = "profile-bot-meta";
  let hasMeta = false;
  if (bot.category) {
    const category = document.createElement("span");
    category.className = "profile-bot-category";
    category.textContent = bot.category;
    meta.append(category);
    hasMeta = true;
  }
  if (bot.badge) {
    const badge = document.createElement("span");
    badge.className = "profile-bot-badge";
    badge.textContent = bot.badge;
    meta.append(badge);
    hasMeta = true;
  }
  body.append(botName, botUri);
  if (hasMeta) {
    body.append(meta);
  }

  const actions = document.createElement("div");
  actions.className = "profile-bot-actions";
  if (bot.pageUrl) {
    actions.append(
      makeLinkButton(document, "Open", bot.pageUrl, onOpenExternal, "profile-bot-link"),
    );
  }
  if (bot.manageUrl) {
    actions.append(
      makeLinkButton(document, "Manage", bot.manageUrl, onOpenExternal, "profile-bot-link"),
    );
  }

  item.append(avatarWrap, body, actions);
  return item;
}

/**
 * @param {Document} document
 * @param {string} label
 * @param {string} url
 * @param {((url: string) => void | Promise<void>) | null} onOpenExternal
 * @param {string} className
 */
function makeLinkButton(document, label, url, onOpenExternal, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => {
    if (typeof onOpenExternal === "function") {
      void onOpenExternal(url);
    }
  });
  return button;
}
