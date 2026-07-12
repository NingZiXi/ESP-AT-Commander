// Terminal 日志全局 store

import { create } from "zustand";
import type { LogEntry } from "../types";

/** 最大保留日志条数，超出后丢弃最早的 */
const MAX_LOGS = 2000;

/** 全局自增 ID，确保每条日志有唯一 key */
let logIdCounter = 0;

/** 为不含 id 的日志条目自动分配 id */
function withId(entry: Omit<LogEntry, "id">): LogEntry {
  return { ...entry, id: ++logIdCounter };
}

interface LogsState {
  logs: LogEntry[];
  append: (entry: Omit<LogEntry, "id">) => void;
  appendMany: (entries: Omit<LogEntry, "id">[]) => void;
  clear: () => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  logs: [],
  append: (entry) =>
    set((s) => {
      const logs = s.logs.length >= MAX_LOGS ? s.logs.slice(1) : s.logs.slice();
      logs.push(withId(entry));
      return { logs };
    }),
  appendMany: (entries) =>
    set((s) => {
      if (entries.length === 0) return s;
      const logs = s.logs.concat(entries.map(withId));
      // 超出上限时只保留最后 MAX_LOGS 条
      return { logs: logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs };
    }),
  clear: () => set({ logs: [] }),
}));
