// 主题切换 store（浅色/深色）

import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Theme = "light" | "dark";

const STORAGE_KEY = "esp-at-commander:theme";

function load(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
    // 跟随系统偏好
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/** 应用 CSS 主题 + 同步原生窗口主题（标题栏/滚动条） */
function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  // 让 Tauri 原生窗口跟随主题（标题栏按钮等）
  getCurrentWindow()
    .setTheme(theme)
    .catch(() => {
      /* 非 Tauri 环境（纯浏览器调试）忽略 */
    });
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

const initial = load();
apply(initial);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  toggle: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark";
      apply(theme);
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        /* 忽略 */
      }
      return { theme };
    }),
  set: (theme) => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* 忽略 */
    }
    set({ theme });
  },
}));
