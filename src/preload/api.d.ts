export interface DockerStatus {
  running?: boolean;
  /** False when the Docker CLI executable is missing (ENOENT). */
  installed?: boolean;
  /** Why Docker is unavailable when `running` is false. */
  reason?: "not_installed" | "not_running" | null;
  image?: string;
  imagePresent?: boolean;
  unsupported?: boolean;
  ok?: boolean;
  error?: string;
  pull?: { status?: string; message?: string };
}

export interface StartupStep {
  id: string;
  label: string;
  state: "done" | "current" | "pending";
}

export interface StartupProgress {
  phase: string;
  label: string;
  detail?: string;
  percent: number;
  steps: StartupStep[];
}

export interface AppConfig {
  projectCreated: boolean;
  telemetryEnabled: boolean;
  telemetry_enabled?: boolean;
  /** Aptabase App Key; empty means no events are sent. */
  aptabaseAppKey: string;
  /** @deprecated Replaced by aptabaseAppKey */
  measurementId?: string;
  appVersion: string;
  project_path?: string;
  install_unique_id?: string;
}

export type RegistryAuthResult =
  | { ok: true; loggedIn: boolean; username: string; registry: string }
  | { ok: false; error: string };

export interface StudioApi {
  host: "desktop" | "web";
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  docker: {
    status: () => Promise<DockerStatus>;
    pull: () => Promise<DockerStatus>;
    ensureRef: (ref: string) => Promise<{
      ok: boolean;
      ref?: string;
      present?: boolean;
      pulled?: boolean;
      error?: string;
    }>;
    ensureLevel1: () => Promise<{
      ok: boolean;
      ref?: string;
      pulled?: boolean;
      cached?: boolean;
      error?: string;
    }>;
    ensureEditor: () => Promise<{ ok: boolean; url?: string; error?: string }>;
    stopEditor: () => Promise<{ ok: boolean; error?: string }>;
    openInstallPage: () => Promise<{ ok: boolean; error?: string }>;
    onProgress: (callback: (payload: unknown) => void) => () => void;
  };
  config: {
    get: () => Promise<AppConfig>;
    set: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  };
  updates: {
    check: () => Promise<{ state?: string; unsupported?: boolean; error?: string }>;
    apply: () => Promise<{ ok: boolean; error?: string; declined?: boolean }>;
    onProgress: (callback: (payload: {
      phase?: string;
      percent?: number;
      label?: string;
      detail?: string;
    }) => void) => () => void;
  };
  notifications: {
    show: (payload: { title: string; body?: string }) => Promise<void>;
    onEvent: (callback: (payload: { mode?: string; title: string; body?: string; action?: string }) => void) => () => void;
  };
  startup: {
    next: () => Promise<{ route: string; message?: string }>;
    retry: () => Promise<{ route: string; message?: string }>;
    current: () => Promise<StartupProgress | null>;
    onRoute: (callback: (payload: { route: string; message?: string }) => void) => () => void;
    onProgress: (callback: (payload: StartupProgress) => void) => () => void;
  };
  project: {
    pickFolder: () => Promise<{ ok: boolean; folder?: string; cancelled?: boolean; error?: string }>;
    open: (folder: string) => Promise<{ ok: boolean; error?: string; config?: AppConfig }>;
    create: (payload: { folder: string; language: string }) => Promise<{ ok: boolean; error?: string }>;
    remove: (folder: string) => Promise<{ ok: boolean; error?: string; config?: AppConfig }>;
  };
  match: {
    start: () => Promise<{ ok: boolean; error?: string }>;
    status: () => Promise<{ ok: boolean; error?: string }>;
  };
  publish: {
    bot: (payload: { botUri: string; tag: string }) => Promise<{ ok: boolean; error?: string }>;
    authStatus: () => Promise<RegistryAuthResult>;
    authLogin: (payload: { username: string; password: string }) => Promise<RegistryAuthResult>;
    authLogout: () => Promise<RegistryAuthResult>;
  };
  account: {
    status: () => Promise<{
      signedIn: boolean;
      profile?: {
        id?: string;
        name?: string;
        username?: string;
        avatarUrl?: string | null;
      } | null;
    }>;
    signIn: () => Promise<{
      ok: boolean;
      signedIn?: boolean;
      error?: string;
      profile?: {
        id?: string;
        name?: string;
        username?: string;
        avatarUrl?: string | null;
      } | null;
    }>;
    signOut: () => Promise<{ ok: boolean; signedIn: boolean; profile: null }>;
    profile: () => Promise<{
      signedIn: boolean;
      profile?: {
        id?: string;
        name?: string;
        username?: string;
        avatarUrl?: string | null;
      } | null;
    }>;
    /** Latest Doorway release tags for an owned bot (newest first, max 3). Tokens stay in main. */
    botTags: (payload: { uri: string }) => Promise<
      | { ok: true; uri: string; tags: string[] }
      | { ok: false; error: string; status?: number; tags: string[] }
    >;
  };
  telemetry: {
    track: (name: string, props?: Record<string, string | number>) => Promise<boolean>;
    setEnabled: (enabled: boolean) => Promise<{
      enabled: boolean;
      initialized: boolean;
      collecting: boolean;
    }>;
    snapshot: () => Promise<{
      enabled: boolean;
      initialized: boolean;
      collecting: boolean;
      appVersion: string;
    }>;
  };
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
