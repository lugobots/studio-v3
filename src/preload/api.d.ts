export type DockerStatusReason =
  | "ok"
  | "not_installed"
  | "not_running"
  | "timeout"
  | "permission";

export interface DockerStatus {
  /** `null` only before a check has finished; `getStatus()` always returns a boolean. */
  running: boolean | null;
  reason?: DockerStatusReason;
}

export type ImageProgressState = "idle" | "pulling" | "ready" | "error";

export interface DockerImageStatus {
  present: boolean;
  pulling: boolean;
  error: string | null;
}

export interface DockerImageProgress extends DockerImageStatus {
  state: ImageProgressState;
  percent: number | null;
  currentBytes: number | null;
  totalBytes: number | null;
  status: string;
}

export interface StoredUserData {
  install_unique_id: string;
  debug_mode: boolean;
  project_path: string;
  team_side: "home" | "away";
  opponent_team: string;
  game_speed: number;
  saved_positions: object[];
  compose_file: string;
  game_server_image: string;
  game_server_version: string;
  bot_level_0_image: string;
  bot_level_0_version: string;
  bot_level_1_image: string;
  bot_level_1_version: string;
  app_path: string;
  app_version: string;
}

export interface AppConfig extends StoredUserData {
  projectCreated: boolean;
  /** Stored `project_path` when Q2 is yes; otherwise `null`. */
  projectPath: string | null;
  /** Present when `config.set` could not write `user.json`. */
  error?: string;
  [extra: string]: unknown;
}

export type ConfigPatch = Partial<StoredUserData> & {
  projectPath?: string | null;
  debugMode?: boolean;
  teamSide?: "home" | "away";
  opponentTeam?: string;
  gameSpeed?: number;
  savedPositions?: object[];
  composeFile?: string;
  gameServerImage?: string;
  gameServerVersion?: string;
  botLevel0Image?: string;
  botLevel0Version?: string;
  botLevel1Image?: string;
  botLevel1Version?: string;
  appPath?: string;
  appVersion?: string;
  installUniqueId?: string;
  projectCreated?: boolean;
  [extra: string]: unknown;
};

export interface UpdateInfo {
  available: boolean;
  version?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
}

export interface UpdateDownloadResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface UpdateProgress {
  receivedBytes: number;
  totalBytes: number | null;
  fileName: string;
}

export interface NotificationPayload {
  title: string;
  body?: string;
}

export interface NotificationResult {
  shown: boolean;
  native: boolean;
}

export interface StudioApi {
  versions: {
    node: string;
    chrome: string;
    electron: string;
    studio: string;
  };
  docker: {
    status: () => Promise<DockerStatus>;
    imageStatus: () => Promise<DockerImageStatus>;
    ensureImage: () => Promise<DockerImageStatus>;
    onImageProgress: (listener: (progress: DockerImageProgress) => void) => () => void;
  };
  config: {
    get: () => Promise<AppConfig>;
    set: (patch: ConfigPatch) => Promise<AppConfig>;
  };
  updates: {
    check: () => Promise<UpdateInfo>;
    download: (info?: UpdateInfo) => Promise<UpdateDownloadResult>;
    cancel: () => Promise<{ cancelled: boolean }>;
    onProgress: (listener: (progress: UpdateProgress) => void) => () => void;
  };
  notifications: {
    show: (payload: NotificationPayload) => Promise<NotificationResult>;
    onShow: (listener: (payload: NotificationPayload) => void) => () => void;
  };
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
