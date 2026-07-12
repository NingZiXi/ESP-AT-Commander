// 命令历史记录 store（Terminal 输入框用 ↑/↓ 翻阅）

import { create } from "zustand";

const STORAGE_KEY = "esp-at-commander:history";
const MAX_HISTORY = 50;

interface HistoryState {
  items: string[];
  add: (cmd: string) => void;
  clear: () => void;
}

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function save(items: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* 忽略 */
  }
}

export const useHistoryStore = create<HistoryState>((set) => ({
  items: load(),
  add: (cmd) =>
    set((s) => {
      const trimmed = cmd.trim();
      if (!trimmed) return s;
      // 去重：若与最后一条相同则不重复添加
      const items = s.items[s.items.length - 1] === trimmed
        ? s.items.slice()
        : [...s.items, trimmed].slice(-MAX_HISTORY);
      save(items);
      return { items };
    }),
  clear: () => {
    save([]);
    set({ items: [] });
  },
}));
