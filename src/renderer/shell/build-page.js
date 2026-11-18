/** Registry host used for bot images (display only; the API owns the real push target). */
export const REGISTRY_HOST = "repo.lugobots.ai";

export function imageRef(uri, tag) {
  return `${REGISTRY_HOST}/${uri}${tag ? `:${tag}` : ""}`;
}

/** Turn an API/publish error into a clear, actionable UI message. */
export function describeBuildError(error) {
  const text = String(error || "").trim();
  if (/missing\s+\.lugo\/Dockerfile/i.test(text) || /dockerfile.*(no such file|not found)/i.test(text)) {
    return "Missing .lugo/Dockerfile: this bot project has no Dockerfile to build. Add .lugo/Dockerfile to the project root and try again.";
  }
  return text || "The build failed.";
}

export function emptyBuildState() {
  return {
    botUri: "",
    tag: "",
    tags: { status: "idle", uri: "", items: [], error: null },
    registry: { status: "idle", username: "", error: null, busy: false },
    run: { status: "idle", image: "", error: "" },
  };
}

/** Why the Build action is unavailable (null when ready). */
export function buildBlockedReason({ bots, build }) {
  if (bots?.status === "loading" || bots?.status === "idle") {
    return "Loading your bots…";
  }
  if (bots?.status === "error") {
    return "Your bots could not be loaded.";
  }
  if (!(bots?.items?.length > 0)) {
    return "You have no bots on this account yet. Create one on Doorway before building an image.";
  }
  if (!build?.botUri) {
    return "Select a bot address.";
  }
  if (!String(build.tag || "").trim()) {
    return "Enter an image tag.";
  }
  if (build.registry?.status === "out") {
    return `Sign in to ${REGISTRY_HOST} before pushing an image.`;
  }
  if (build.run?.status === "building") {
    return "A build is already running.";
  }
  return null;
}

function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function section(document, name, title) {
  const node = el(document, "section", "build-section");
  node.setAttribute("data-build-section", name);
  node.dataset.buildSection = name;
  if (title) {
    node.append(el(document, "h2", "build-section-title", title));
  }
  return node;
}

function helper(document, text, modifier = "") {
  return el(document, "p", `build-helper${modifier ? ` build-helper--${modifier}` : ""}`, text);
}

function field(document, labelText, control) {
  const wrap = el(document, "label", "build-field");
  wrap.append(el(document, "span", "build-field-label", labelText), control);
  return wrap;
}

/**
 * Build main pane: auth-gated bot image build + push.
 * @param {Document} document
 * @param {{
 *   account: { signedIn?: boolean } | null,
 *   bots?: { status?: string, items?: Array<{ uri?: string, name?: string }>, error?: string | null } | null,
 *   build?: ReturnType<typeof emptyBuildState>,
 *   busy?: boolean,
 *   onSignIn: () => void | Promise<void>,
 *   onSelectBot?: (uri: string) => void,
 *   onTagChange?: (tag: string) => void,
 *   onBuild?: () => void | Promise<void>,
 *   onRetryBots?: () => void,
 *   onRetryTags?: () => void,
 *   onRetryRegistry?: () => void,
 *   onRegistryLogin?: (credentials: { username: string, password: string }) => void | Promise<void>,
 *   onRegistryLogout?: () => void | Promise<void>,
 * }} options
 */
export function renderBuildPage(
  document,
  {
    account,
    bots = null,
    build = emptyBuildState(),
    busy = false,
    onSignIn,
    onSelectBot = () => {},
    onTagChange = () => {},
    onBuild = () => {},
    onRetryBots = () => {},
    onRetryTags = () => {},
    onRetryRegistry = () => {},
    onRegistryLogin = () => {},
    onRegistryLogout = () => {},
  },
) {
  const root = el(document, "section", "build-page");
  root.setAttribute("data-window", "build");
  root.dataset.window = "build";

  const header = el(document, "header", "build-page-header");
  header.append(el(document, "h1", null, "Build"));
  root.append(header);

  if (!account?.signedIn) {
    const panel = section(document, "sign-in");
    panel.append(
      helper(
        document,
        "Sign in with your Doorway account to build your bot project into an image and push it to your bot address.",
      ),
    );
    const button = el(
      document,
      "button",
      "button button-primary build-action",
      busy ? "Signing in…" : "Sign in with Doorway",
    );
    button.type = "button";
    button.disabled = Boolean(busy);
    button.addEventListener("click", () => {
      void onSignIn();
    });
    panel.append(button);
    root.append(panel);
    return root;
  }

  const items = Array.isArray(bots?.items) ? bots.items : [];
  const botsStatus = bots?.status || "idle";
  const running = build.run?.status === "building";

  // Target: bot address + tag.
  const target = section(document, "target", "Image");
  target.setAttribute("data-bots-state", botsStatus === "idle" ? "loading" : botsStatus);

  let tagInput = null;
  let imageNote = null;

  if (botsStatus === "loading" || botsStatus === "idle") {
    target.append(helper(document, "Loading your bots…"));
  } else if (botsStatus === "error") {
    target.append(
      helper(
        document,
        bots?.error ? `Could not load your bots (${bots.error}).` : "Could not load your bots.",
        "error",
      ),
    );
    const retry = el(document, "button", "button button-secondary build-action", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => onRetryBots());
    target.append(retry);
  } else if (items.length === 0) {
    target.setAttribute("data-bots-state", "empty");
    target.append(
      helper(
        document,
        "You have no bots on this account yet. Create one on Doorway before building an image.",
      ),
    );
  } else {
    const select = el(document, "select", "build-select");
    select.setAttribute("aria-label", "Bot address");
    select.setAttribute("data-build-field", "bot");
    for (const bot of items) {
      const option = el(document, "option", null, imageRef(bot.uri));
      option.value = bot.uri;
      if (bot.uri === build.botUri) {
        option.selected = true;
      }
      select.append(option);
    }
    if (build.botUri) {
      select.value = build.botUri;
    }
    select.addEventListener("change", () => onSelectBot(select.value));
    target.append(field(document, "Bot address", select));

    tagInput = el(document, "input", "build-input");
    tagInput.type = "text";
    tagInput.setAttribute("aria-label", "Image tag");
    tagInput.setAttribute("data-build-field", "tag");
    tagInput.dataset.buildField = "tag";
    tagInput.setAttribute("placeholder", "v1.0.0");
    tagInput.placeholder = "v1.0.0";
    tagInput.value = build.tag || "";
    target.append(field(document, "Tag", tagInput));
    imageNote = helper(document, "");
    imageNote.setAttribute("data-build-image", "true");
    target.append(imageNote);
  }
  root.append(target);

  // Latest tags for the selection.
  if (items.length > 0) {
    const tags = section(document, "tags", "Latest tags");
    const tagsState = build.tags?.status || "idle";
    tags.setAttribute("data-tags-state", tagsState === "idle" ? "loading" : tagsState);
    if (tagsState === "loading" || tagsState === "idle") {
      tags.append(helper(document, "Loading tags…"));
    } else if (tagsState === "error") {
      tags.append(
        helper(
          document,
          build.tags?.error
            ? `Could not load tags (${build.tags.error}). You can still enter a tag and build.`
            : "Could not load tags. You can still enter a tag and build.",
          "error",
        ),
      );
      const retry = el(document, "button", "button button-secondary build-action", "Retry");
      retry.type = "button";
      retry.addEventListener("click", () => onRetryTags());
      tags.append(retry);
    } else if (!(build.tags?.items?.length > 0)) {
      tags.setAttribute("data-tags-state", "empty");
      tags.append(helper(document, "No releases published for this bot yet."));
    } else {
      const list = el(document, "ul", "build-tag-list");
      for (const tag of build.tags.items) {
        list.append(el(document, "li", "build-tag-item", tag));
      }
      tags.append(list);
    }
    root.append(tags);

    root.append(renderRegistrySection(document, build.registry, {
      onRetryRegistry,
      onRegistryLogin,
      onRegistryLogout,
    }));
  }

  // Build action + run status.
  const action = section(document, "action");
  const buildButton = el(
    document,
    "button",
    "button button-primary build-action",
    running ? "Building…" : "Build and push image",
  );
  buildButton.type = "button";
  buildButton.setAttribute("data-build-action", "build");
  const blockedNote = helper(document, "");
  blockedNote.setAttribute("data-build-blocked", "true");
  buildButton.addEventListener("click", () => {
    if (!buildButton.disabled) {
      void onBuild();
    }
  });
  action.append(buildButton, blockedNote);

  const status = renderRunStatus(document, build.run);
  if (status) {
    action.append(status);
  }
  root.append(action);

  function sync() {
    const current = { ...build, tag: tagInput ? tagInput.value : build.tag };
    const reason = buildBlockedReason({ bots, build: current });
    buildButton.disabled = Boolean(reason);
    blockedNote.textContent = reason && !running ? reason : "";
    blockedNote.hidden = !blockedNote.textContent;
    if (imageNote) {
      imageNote.textContent =
        current.botUri && current.tag.trim()
          ? `Will push ${imageRef(current.botUri, current.tag.trim())}`
          : "Enter a tag to see the full image name.";
    }
  }

  if (tagInput) {
    tagInput.addEventListener("input", () => {
      onTagChange(tagInput.value);
      sync();
    });
    tagInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !buildButton.disabled) {
        event.preventDefault();
        void onBuild();
      }
    });
  }
  sync();

  return root;
}

function renderRegistrySection(document, registry, { onRetryRegistry, onRegistryLogin, onRegistryLogout }) {
  const node = section(document, "registry", "Registry");
  const state = registry?.status || "idle";
  node.setAttribute("data-registry-state", state === "idle" ? "loading" : state);

  if (state === "loading" || state === "idle") {
    node.append(helper(document, `Checking ${REGISTRY_HOST} sign-in…`));
    return node;
  }

  if (state === "error") {
    node.append(
      helper(
        document,
        registry?.error
          ? `Could not check ${REGISTRY_HOST} sign-in (${registry.error}).`
          : `Could not check ${REGISTRY_HOST} sign-in.`,
        "error",
      ),
    );
    const retry = el(document, "button", "button button-secondary build-action", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => onRetryRegistry());
    node.append(retry);
    return node;
  }

  if (state === "in") {
    node.append(
      helper(
        document,
        registry.username
          ? `Signed in to ${REGISTRY_HOST} as ${registry.username}.`
          : `Signed in to ${REGISTRY_HOST}.`,
      ),
    );
    const logout = el(
      document,
      "button",
      "button button-secondary build-action",
      registry.busy ? "Signing out…" : "Sign out of registry",
    );
    logout.type = "button";
    logout.disabled = Boolean(registry.busy);
    logout.addEventListener("click", () => {
      void onRegistryLogout();
    });
    node.append(logout);
    return node;
  }

  // state === "out"
  node.append(
    helper(
      document,
      `Sign in to ${REGISTRY_HOST} with your Lugo Bots website username and password to push images.`,
    ),
  );
  if (registry.error) {
    node.append(helper(document, registry.error, "error"));
  }
  const username = el(document, "input", "build-input");
  username.type = "text";
  username.setAttribute("aria-label", "Registry username");
  username.setAttribute("autocomplete", "username");
  const password = el(document, "input", "build-input");
  password.type = "password";
  password.setAttribute("aria-label", "Registry password");
  password.setAttribute("autocomplete", "current-password");
  node.append(field(document, "Username", username), field(document, "Password", password));
  const login = el(
    document,
    "button",
    "button button-secondary build-action",
    registry.busy ? "Signing in…" : "Sign in to registry",
  );
  login.type = "button";
  login.setAttribute("data-registry-action", "login");
  login.disabled = Boolean(registry.busy);
  login.addEventListener("click", () => {
    // Credentials are read only here and are never kept in renderer state.
    void onRegistryLogin({ username: username.value, password: password.value });
  });
  node.append(login);
  return node;
}

function renderRunStatus(document, run) {
  if (!run || run.status === "idle") {
    return null;
  }
  const node = el(document, "div", `build-run build-run--${run.status}`);
  node.setAttribute("data-build-run", run.status);
  node.dataset.buildRun = run.status;
  node.setAttribute("role", run.status === "error" ? "alert" : "status");

  if (run.status === "building") {
    node.append(
      el(
        document,
        "p",
        "build-run-text",
        `Building and pushing ${run.image}… This can take several minutes; keep Studio open.`,
      ),
    );
    const track = el(document, "div", "build-progress");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Build in progress");
    track.append(el(document, "div", "build-progress-fill"));
    node.append(track);
  } else if (run.status === "success") {
    node.append(el(document, "p", "build-run-text", `Published ${run.image}`));
  } else {
    node.append(el(document, "p", "build-run-text", describeBuildError(run.error)));
  }
  return node;
}
