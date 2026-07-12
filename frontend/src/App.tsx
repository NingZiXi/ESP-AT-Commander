import { useEffect, useState } from "react";
import { SerialBar } from "./components/SerialBar";
import { CommandTree } from "./components/CommandTree";
import { Terminal } from "./components/Terminal";
import { ParamForm } from "./components/ParamForm";
import { StatusBar } from "./components/StatusBar";
import { ScriptPanel } from "./components/ScriptPanel";
import { WindowControls } from "./components/WindowControls";
import { SettingsModal } from "./components/SettingsModal";
import { useSerialStore } from "./stores/serial";
import { useLogsStore } from "./stores/logs";
import { useStatsStore } from "./stores/stats";
import type { AtCommand } from "./types";

function App() {
  const [selected, setSelected] = useState<AtCommand | null>(null);
  const [activeTab, setActiveTab] = useState<"param" | "script">("param");
  const [preset, setPreset] = useState<Record<string, string> | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** 加载收藏预设：切换到对应命令 + 回填参数 */
  const handleLoadFavorite = (cmd: AtCommand, values: Record<string, string>) => {
    setSelected(cmd);
    setPreset(values);
    setActiveTab("param");
  };

  /** 切换脚本面板 */
  const handleScriptToggle = () => {
    setActiveTab((t) => (t === "script" ? "param" : "script"));
  };

  /** 打开设置 */
  const handleOpenSettings = () => {
    setSettingsOpen(true);
  };

  /** 当前串口错误 — 3 秒后自动消失 */
  const { error, setError } = useSerialStore();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error, setError]);

  /** 全局快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+L: 清空终端
      if ((e.ctrlKey || e.metaKey) && e.key === "l" && !e.shiftKey) {
        e.preventDefault();
        useLogsStore.getState().clear();
        useStatsStore.getState().reset();
        return;
      }
      // Ctrl+K: 聚焦命令搜索框
      if ((e.ctrlKey || e.metaKey) && e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".tree-search input");
        input?.focus();
        input?.select();
        return;
      }
      // Ctrl+,: 打开设置
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // Esc: 关闭设置面板
      if (e.key === "Escape" && settingsOpen) {
        e.preventDefault();
        setSettingsOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  return (
    <div className="app">
      <SerialBar
        onScriptToggle={handleScriptToggle}
        onOpenSettings={handleOpenSettings}
        scriptActive={activeTab === "script"}
      />
      <WindowControls />
      {error && (
        <div className="err-toast">
          <span className="err-dot" />
          {error}
        </div>
      )}
      <div className="main">
        <CommandTree
          selected={selected?.id ?? ""}
          onSelect={setSelected}
          onLoadFavorite={handleLoadFavorite}
        />
        <Terminal />
        <div className="right-panel">
          <div className="right-tabs">
            <button
              className={`right-tab ${activeTab === "param" ? "is-active" : ""}`}
              onClick={() => setActiveTab("param")}
            >
              参数
            </button>
            <button
              className={`right-tab ${activeTab === "script" ? "is-active" : ""}`}
              onClick={() => setActiveTab("script")}
            >
              脚本
            </button>
          </div>
          {activeTab === "param" ? (
            <ParamForm
              command={selected}
              presetValues={preset}
              onPresetConsumed={() => setPreset(null)}
            />
          ) : (
            <ScriptPanel />
          )}
        </div>
      </div>
      <StatusBar />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
