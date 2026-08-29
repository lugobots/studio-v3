export interface DockerStatus {
  running: boolean | null;
}

export interface AppConfig {
  projectCreated: boolean;
}

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
    set: (patch: Partial<AppConfig>) => Promise<AppConfig>;
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
