import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSerialStore, type DataBits, type StopBits, type Parity } from "../stores/serial";
import { useThemeStore } from "../stores/theme";
import { useSettingsStore } from "../stores/settings";

interface PortInfo {
  name: string;
  product: string | null;
}

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const DATA_BITS: DataBits[] = [5, 6, 7, 8];
const STOP_BITS: StopBits[] = [1, 2];
const PARITIES: Parity[] = ["None", "Odd", "Even"];
// 校验位字母简称
const PARITY_LETTER: Record<Parity, string> = { None: "N", Odd: "O", Even: "E" };

interface Props {
  onScriptToggle?: () => void;
  scriptActive?: boolean;
  onOpenSettings?: () => void;
}

export function SerialBar({ onScriptToggle, scriptActive, onOpenSettings }: Props = {}) {
  const {
    status, port, baud, dataBits, stopBits, parity,
    error, setStatus, setPort, setBaud, setDataBits, setStopBits, setParity,
    setError, setConnectedAt,
  } = useSerialStore();
  const { theme, set: setTheme } = useThemeStore();
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);

  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true);
    try {
      const list = await invoke<PortInfo[]>("list_ports");
      setPorts(list);
      if (list.length > 0 && !list.some((p) => p.name === port)) {
        setPort(list[0].name);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : "枚举串口失败");
    } finally {
      setLoadingPorts(false);
    }
  }, [port, setPort]);

  useEffect(() => {
    refreshPorts();
  }, [refreshPorts]);

  const connected = status === "connected";
  const connecting = status === "connecting";

  const toggle = async () => {
    setError(null);
    if (connected) {
      try {
        await invoke("disconnect_port");
        setStatus("disconnected");
      } catch (err) {
        setError(typeof err === "string" ? err : "断开失败");
      }
    } else {
      if (!port) {
        setError("请先选择串口");
        return;
      }
      setStatus("connecting");
      try {
        await invoke("connect_port", {
          port,
          baudRate: baud,
          dataBits,
          stopBits,
          parity,
        });
        setStatus("connected");
        setConnectedAt();
      } catch (err) {
        setStatus("disconnected");
        setError(typeof err === "string" ? err : "连接失败");
      }
    }
  };

  return (
    <div className="serial-bar" data-tauri-drag-region>
      {/* 品牌区（可拖拽移动窗口） */}
      <div className="brand" data-tauri-drag-region>
        <span className="brand-dot" />
        <span className="brand-name">ESP-AT Commander</span>
      </div>

      {/* 串口配置区 */}
      <div className="serial-fields">
        <div className="field-group">
          <span className="field-label">Port</span>
          <div className="select-wrap">
            <select
              value={port}
              onChange={(e) => setPort(e.target.value)}
              disabled={connected}
              className="field-select"
            >
              {ports.length === 0 && <option value="">无可用串口</option>}
              {ports.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.product ? ` · ${p.product}` : ""}
                </option>
              ))}
            </select>
            <span className="select-arrow">▾</span>
          </div>
        </div>

        <div className="field-group">
          <span className="field-label">Baud</span>
          <div className="select-wrap">
            <select
              value={baud}
              onChange={(e) => setBaud(Number(e.target.value))}
              disabled={connected}
              className="field-select"
            >
              {BAUDS.map((b) => (
                <option key={b} value={b}>
                  {b.toLocaleString()}
                </option>
              ))}
            </select>
            <span className="select-arrow">▾</span>
          </div>
        </div>

        <div className="field-group format-fields">
          <span className="field-label">Format</span>
          <div className="format-controls">
            <div className="select-wrap select-wrap--mini" title="数据位">
              <select
                value={dataBits}
                onChange={(e) => setDataBits(Number(e.target.value) as DataBits)}
                disabled={connected}
                className="field-select field-select--mini"
              >
                {DATA_BITS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="select-arrow">▾</span>
            </div>
            <div className="select-wrap select-wrap--mini" title="校验位 (N=无, O=奇, E=偶)">
              <select
                value={parity}
                onChange={(e) => setParity(e.target.value as Parity)}
                disabled={connected}
                className="field-select field-select--mini"
              >
                {PARITIES.map((p) => (
                  <option key={p} value={p}>{PARITY_LETTER[p]}</option>
                ))}
              </select>
              <span className="select-arrow">▾</span>
            </div>
            <div className="select-wrap select-wrap--mini" title="停止位">
              <select
                value={stopBits}
                onChange={(e) => setStopBits(Number(e.target.value) as StopBits)}
                disabled={connected}
                className="field-select field-select--mini"
              >
                {STOP_BITS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="select-arrow">▾</span>
            </div>
          </div>
        </div>
      </div>

      {/* 工具区 */}
      <div className="serial-tools">
        {onScriptToggle && (
          <button
            className={`tool-btn ${scriptActive ? "active" : ""}`}
            onClick={onScriptToggle}
            title="脚本执行面板"
          >
            <span className="tool-icon">▶</span>
            <span className="tool-text">Script</span>
          </button>
        )}
        <button
          className="tool-btn"
          onClick={() => {
            // 顶栏切换：同时更新 useThemeStore(立即应用 CSS)和 useSettingsStore(持久化偏好)
            const next: "light" | "dark" = theme === "dark" ? "light" : "dark";
            setTheme(next);
            setThemeMode(next);
          }}
          title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        >
          <span className="tool-icon">{theme === "dark" ? "☀" : "☾"}</span>
        </button>
        <button
          className="tool-btn"
          onClick={refreshPorts}
          disabled={loadingPorts || connected}
          title="刷新串口列表"
        >
          <span className={`tool-icon ${loadingPorts ? "spin" : ""}`}>⟳</span>
        </button>
        {onOpenSettings && (
          <button
            className="tool-btn"
            onClick={onOpenSettings}
            title="设置 (Ctrl+,)"
          >
            <span className="tool-icon">⚙</span>
          </button>
        )}
      </div>

      <div className="spacer" />

      {/* 连接按钮 */}
      <button
        className={`connect-btn ${connected ? "connected" : ""} ${connecting ? "connecting" : ""}`}
        onClick={toggle}
        disabled={connecting}
      >
        <span className={`connect-pd ${connected ? "on" : "off"}`} />
        <span className="connect-label">
          {connecting ? "Connecting…" : connected ? "Connected" : "Connect"}
        </span>
      </button>
    </div>
  );
}
