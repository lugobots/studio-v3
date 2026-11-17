const STATIC_BOTS = [
  { name: "My First Bot", uri: "demo/my-first-bot" },
  { name: "Home Team", uri: "demo/home-team" },
  { name: "Away Scrimmage", uri: "demo/away-scrimmage" },
];

/**
 * Profile main pane: Doorway sign-in / identity / static bots / logout.
 * @param {Document} document
 * @param {{
 *   account: { signedIn?: boolean, profile?: object | null } | null,
 *   busy?: boolean,
 *   onSignIn: () => void | Promise<void>,
 *   onSignOut: () => void | Promise<void>,
 * }} options
 */
export function renderProfilePage(document, { account, busy = false, onSignIn, onSignOut }) {
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

  const bots = document.createElement("section");
  bots.className = "profile-section";
  bots.setAttribute("data-profile-section", "bots");
  const botsTitle = document.createElement("h2");
  botsTitle.className = "profile-section-title";
  botsTitle.textContent = "Bots";
  const note = document.createElement("p");
  note.className = "profile-helper";
  note.textContent = "Sample list (not loaded from Doorway yet).";
  const list = document.createElement("ul");
  list.className = "profile-bot-list";
  for (const bot of STATIC_BOTS) {
    const item = document.createElement("li");
    item.className = "profile-bot-item";
    const botName = document.createElement("span");
    botName.className = "profile-bot-name";
    botName.textContent = bot.name;
    const botUri = document.createElement("span");
    botUri.className = "profile-bot-uri";
    botUri.textContent = bot.uri;
    item.append(botName, botUri);
    list.append(item);
  }
  bots.append(botsTitle, note, list);
  root.append(bots);

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

export { STATIC_BOTS };
