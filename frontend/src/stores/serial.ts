// 串口连接状态全局 store

import { create } from "zustand";
import type { ConnectionStatus } from "../types";

export type DataBits = 5 | 6 | 7 | 8;
export type StopBits = 1 | 2;
export type Parity = "None" | "Odd" | "Even";

const STORAGE_KEY = "esp-at-commander:serial-settings";

interface SerialSettings {
  port: string;
  baud: number;
  dataBits: DataBits;
  stopBits: StopBits;
  parity: Parity;
}

function loadSettings(): Partial<SerialSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<SerialSettings>;
  } catch {
    return {};
  }
}

function saveSettings(s: SerialSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

interface SerialState extends SerialSettings {
  status: ConnectionStatus;
  error: string | null;
  connectedAt: number | null;
  setStatus: (s: ConnectionStatus) => void;
  setPort: (p: string) => void;
  setBaud: (b: number) => void;
  setDataBits: (b: DataBits) => void;
  setStopBits: (b: StopBits) => void;
  setParity: (p: Parity) => void;
  setError: (e: string | null) => void;
  setConnectedAt: () => void;
}

const initial = loadSettings();

export const useSerialStore = create<SerialState>((set, get) => {
  const persist = () => {
    const { port, baud, dataBits, stopBits, parity } = get();
    saveSettings({ port, baud, dataBits, stopBits, parity });
  };
  return {
    status: "disconnected",
    port: initial.port ?? "",
    baud: initial.baud ?? 115200,
    dataBits: (initial.dataBits ?? 8) as DataBits,
    stopBits: (initial.stopBits ?? 1) as StopBits,
    parity: (initial.parity ?? "None") as Parity,
    error: null,
    connectedAt: null,
    setStatus: (status) => set({ status }),
    setPort: (port) => { set({ port }); persist(); },
    setBaud: (baud) => { set({ baud }); persist(); },
    setDataBits: (dataBits) => { set({ dataBits }); persist(); },
    setStopBits: (stopBits) => { set({ stopBits }); persist(); },
    setParity: (parity) => { set({ parity }); persist(); },
    setError: (error) => set({ error }),
    setConnectedAt: () => set({ connectedAt: Date.now() }),
  };
});
