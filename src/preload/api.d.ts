export interface DockerStatus {
  running: boolean | null;
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
}

export interface StudioApi {
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  docker: {
    status: () => Promise<DockerStatus>;
  };
  config: {
    get: () => Promise<AppConfig>;
    set: (patch: ConfigPatch) => Promise<AppConfig>;
  };
  updates: {
    check: () => Promise<UpdateInfo>;
  };
  notifications: {
    show: (payload: { title: string; body?: string }) => Promise<void>;
  };
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
