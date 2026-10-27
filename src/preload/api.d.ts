export interface DockerStatus {
  running?: boolean;
  image?: string;
  imagePresent?: boolean;
  unsupported?: boolean;
  ok?: boolean;
  error?: string;
}

export interface AppConfig {
  projectCreated: boolean;
  telemetryEnabled: boolean;
  telemetry_enabled?: boolean;
  measurementId: string;
  appVersion: string;
  project_path?: string;
  install_unique_id?: string;
}

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
    onProgress: (callback: (payload: unknown) => void) => () => void;
  };
  config: {
    get: () => Promise<AppConfig>;
    set: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  };
  updates: {
    check: () => Promise<{ state?: string; unsupported?: boolean; error?: string }>;
    apply: () => Promise<{ ok: boolean; error?: string; declined?: boolean }>;
  };
  notifications: {
    show: (payload: { title: string; body?: string }) => Promise<void>;
    onEvent: (callback: (payload: { mode?: string; title: string; body?: string; action?: string }) => void) => () => void;
  };
  startup: {
    next: () => Promise<{ route: string; message?: string }>;
    retry: () => Promise<{ route: string; message?: string }>;
    onRoute: (callback: (payload: { route: string; message?: string }) => void) => () => void;
  };
  project: {
    pickFolder: () => Promise<{ ok: boolean; folder?: string; cancelled?: boolean; error?: string }>;
    open: (folder: string) => Promise<{ ok: boolean; error?: string; config?: AppConfig }>;
    create: (payload: { folder: string; language: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  match: {
    start: () => Promise<{ ok: boolean; error?: string }>;
    status: () => Promise<{ ok: boolean; error?: string }>;
  };
  publish: {
    bot: (payload: { botUri: string; tag: string }) => Promise<{ ok: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
