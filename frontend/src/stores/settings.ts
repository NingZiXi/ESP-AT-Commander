// 全局应用设置（持久化到 localStorage）

import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type LineEnding = "CR" | "LF" | "CRLF" | "None";

export interface Settings {
  themeMode: ThemeMode;
  defaultBaud: number;
  lineEnding: LineEnding;
  localEcho: boolean;
  autoConnect: boolean;
  clearOnConnect: boolean;
  maxLogCount: number;
}

const STORAGE_KEY = "esp-at-commander:app-settings";

const DEFAULTS: Settings = {
  themeMode: "system",
  defaultBaud: 115200,
  lineEnding: "CRLF",
  localEcho: false,
  autoConnect: false,
  clearOnConnect: true,
  maxLogCount: 5000,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

interface SettingsState extends Settings {
  setThemeMode: (m: ThemeMode) => void;
  setDefaultBaud: (b: number) => void;
  setLineEnding: (l: LineEnding) => void;
  setLocalEcho: (v: boolean) => void;
  setAutoConnect: (v: boolean) => void;
  setClearOnConnect: (v: boolean) => void;
  setMaxLogCount: (n: number) => void;
  resetDefaults: () => void;
}

function pickState(s: SettingsState): Settings {
  return {
    themeMode: s.themeMode,
    defaultBaud: s.defaultBaud,
    lineEnding: s.lineEnding,
    localEcho: s.localEcho,
    autoConnect: s.autoConnect,
    clearOnConnect: s.clearOnConnect,
    maxLogCount: s.maxLogCount,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  setThemeMode: (themeMode) => { set({ themeMode }); save(pickState(get())); },
  setDefaultBaud: (defaultBaud) => { set({ defaultBaud }); save(pickState(get())); },
  setLineEnding: (lineEnding) => { set({ lineEnding }); save(pickState(get())); },
  setLocalEcho: (localEcho) => { set({ localEcho }); save(pickState(get())); },
  setAutoConnect: (autoConnect) => { set({ autoConnect }); save(pickState(get())); },
  setClearOnConnect: (clearOnConnect) => { set({ clearOnConnect }); save(pickState(get())); },
  setMaxLogCount: (maxLogCount) => { set({ maxLogCount }); save(pickState(get())); },
  resetDefaults: () => { set(DEFAULTS); save(DEFAULTS); },
}));
