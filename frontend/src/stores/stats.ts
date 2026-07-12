// 收发统计 store

import { create } from "zustand";
import type { LogEntry } from "../types";

interface StatsState {
  txCount: number;
  rxCount: number;
  okCount: number;
  errorCount: number;
  eventCount: number;
  txBytes: number;
  rxBytes: number;
  incTx: (bytes?: number) => void;
  incRx: (type: LogEntry["type"], bytes?: number) => void;
  reset: () => void;
}

export const useStatsStore = create<StatsState>((set) => ({
  txCount: 0,
  rxCount: 0,
  okCount: 0,
  errorCount: 0,
  eventCount: 0,
  txBytes: 0,
  rxBytes: 0,
  incTx: (bytes) =>
    set((s) => ({
      txCount: s.txCount + 1,
      txBytes: s.txBytes + (bytes ?? 1),
    })),
  incRx: (type, bytes) =>
    set((s) => ({
      rxCount: s.rxCount + 1,
      rxBytes: s.rxBytes + (bytes ?? 1),
      okCount: type === "ok" ? s.okCount + 1 : s.okCount,
      errorCount: type === "error" ? s.errorCount + 1 : s.errorCount,
      eventCount: type === "event" ? s.eventCount + 1 : s.eventCount,
    })),
  reset: () =>
    set({
      txCount: 0,
      rxCount: 0,
      okCount: 0,
      errorCount: 0,
      eventCount: 0,
      txBytes: 0,
      rxBytes: 0,
    }),
}));
