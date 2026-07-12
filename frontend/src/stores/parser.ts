// 解析规则全局 store

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { LogEntry } from "../types";

interface ParserRule {
  pattern: string;
  type: LogEntry["type"];
}

interface ParserState {
  rules: ParserRule[];
  regexes: RegExp[];
  loaded: boolean;
  load: () => Promise<void>;
  classify: (line: string) => LogEntry["type"];
}

export const useParserStore = create<ParserState>((set, get) => ({
  rules: [],
  regexes: [],
  loaded: false,
  load: async () => {
    try {
      const data = await invoke<{ rules: ParserRule[] }>("load_parser");
      const regexes = data.rules.map((r) => new RegExp(r.pattern));
      set({ rules: data.rules, regexes, loaded: true });
    } catch (err) {
      console.error("load_parser failed:", err);
      set({ loaded: true });
    }
  },
  classify: (line: string): LogEntry["type"] => {
    const { regexes, rules } = get();
    for (let i = 0; i < regexes.length; i++) {
      if (regexes[i].test(line)) {
        return rules[i].type;
      }
    }
    return "raw";
  },
}));
