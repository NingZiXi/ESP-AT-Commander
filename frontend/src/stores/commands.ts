// 命令库全局 store

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { CommandCategory } from "../types";

interface CommandsState {
  categories: CommandCategory[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useCommandsStore = create<CommandsState>((set) => ({
  categories: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await invoke<{ categories: CommandCategory[] }>("load_commands");
      set({ categories: data.categories ?? [], loading: false });
    } catch (err) {
      set({
        loading: false,
        error: typeof err === "string" ? err : "加载命令库失败",
      });
    }
  },
}));
