import { useEffect, useState } from "react";
import { getVersion, getName } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, type ThemeMode, type LineEnding } from "../stores/settings";
import { useThemeStore } from "../stores/theme";

type Category = "about" | "appearance" | "general" | "shortcuts" | "data";

// === 项目信息（后续创建仓库后只需改下面两个常量） ===
const GITHUB_PROFILE = "https://github.com/NingZiXi";
const GITHUB_REPO_URL = "https://github.com/NingZiXi/ESP-AT-Commander";
const AUTHOR_NAME = "NingZiXi";
const AUTHOR_DISPLAY = "NingZiXi (@NingZiXi)";

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "about",       label: "关于",     icon: "ⓘ" },
  { id: "appearance",  label: "外观",     icon: "☀" },
  { id: "general",     label: "通用",     icon: "⚙" },
  { id: "shortcuts",   label: "快捷键",   icon: "⌨" },
  { id: "data",        label: "数据",     icon: "▤" },
];

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light",  label: "浅色" },
  { value: "dark",   label: "深色" },
];

const LINE_ENDINGS: { value: LineEnding; label: string }[] = [
  { value: "CR",   label: "CR (\\r, 旧 Mac)" },
  { value: "LF",   label: "LF (\\n, Unix/Linux)" },
  { value: "CRLF", label: "CRLF (\\r\\n, Windows / AT 命令推荐)" },
  { value: "None", label: "无 (手动控制)" },
];

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/** 快捷键清单（按模块分组） */
const SHORTCUT_GROUPS: { module: string; items: { keys: string; desc: string }[] }[] = [
  {
    module: "脚本",
    items: [
      { keys: "Ctrl + S",         desc: "保存当前脚本" },
      { keys: "Ctrl + Z",         desc: "把最后一步移到开头" },
      { keys: "Ctrl + Shift + Z", desc: "把开头一步移到末尾" },
    ],
  },
  {
    module: "终端",
    items: [
      { keys: "↑ / ↓",       desc: "在输入框中切换历史命令" },
      { keys: "Enter",       desc: "发送当前输入的命令" },
      { keys: "Ctrl + L",    desc: "清空终端日志" },
    ],
  },
  {
    module: "窗口",
    items: [
      { keys: "F11",         desc: "切换全屏" },
      { keys: "Esc",         desc: "关闭弹窗/取消操作" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [category, setCategory] = useState<Category>("about");
  const [appVersion, setAppVersion] = useState<string>("...");
  const [appName, setAppName] = useState<string>("ESP-AT Commander");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const settings = useSettingsStore();
  const theme = useThemeStore();
  // 让响应式生效：从 settings 派生实际 theme
  const effectiveTheme = settings.themeMode === "system"
    ? (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.themeMode;

  useEffect(() => {
    if (theme.theme !== effectiveTheme) theme.set(effectiveTheme);
  }, [effectiveTheme, theme]);

  useEffect(() => {
    if (!open) return;
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.1.0"));
    getName().then(setAppName).catch(() => {});
  }, [open]);

  if (!open) return null;

  const showToast = (kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 2500);
  };

  // ===== 数据操作 =====
  const clearDrafts = () => {
    try {
      localStorage.removeItem("esp-at-commander:script-draft");
      showToast("ok", "草稿已清空");
    } catch { showToast("err", "清空失败"); }
  };
  const clearTemplates = () => {
    try {
      localStorage.removeItem("esp-at-commander:step-templates");
      showToast("ok", "模板已清空");
    } catch { showToast("err", "清空失败"); }
  };
  const clearFavorites = () => {
    try {
      localStorage.removeItem("esp-at-commander:favorites");
      showToast("ok", "收藏已清空");
    } catch { showToast("err", "清空失败"); }
  };
  const clearTerminal = () => {
    try {
      localStorage.removeItem("esp-at-commander:terminal-history");
      showToast("ok", "终端历史已清空");
    } catch { showToast("err", "清空失败"); }
  };

  const exportAll = async () => {
    try {
      const data: Record<string, unknown> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("esp-at-commander:")) {
          const v = localStorage.getItem(k);
          if (v) {
            try { data[k] = JSON.parse(v); }
            catch { data[k] = v; }
          }
        }
      }
      data["__exportedAt"] = new Date().toISOString();
      data["__appVersion"] = appVersion;
      const path = await openDialog({
        title: "导出设置到…",
        defaultPath: `esp-at-commander-backup-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
        save: true,
      });
      if (!path) return;
      await writeTextFile(path as string, JSON.stringify(data, null, 2));
      showToast("ok", "已导出");
    } catch (err) {
      showToast("err", typeof err === "string" ? err : "导出失败");
    }
  };

  const importAll = async () => {
    try {
      const path = await openDialog({
        title: "选择要导入的设置文件",
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return;
      const raw = await readTextFile(path as string);
      const data = JSON.parse(raw) as Record<string, unknown>;
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith("esp-at-commander:") && k !== "__appVersion" && k !== "__exportedAt") {
          localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
          count++;
        }
      }
      showToast("ok", `已导入 ${count} 项,刷新后生效`);
    } catch (err) {
      showToast("err", typeof err === "string" ? err : "导入失败");
    }
  };

  const handleOpenUrl = (url: string) => {
    invoke("open_url", { url }).catch(() => {
      // fallback: try window.open
      window.open(url, "_blank");
    });
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">设置</div>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`settings-cat ${category === c.id ? "is-active" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              <span className="settings-cat-icon">{c.icon}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <div className="settings-main">
          <div className="settings-main-header">
            <span className="settings-main-title">
              {CATEGORIES.find((c) => c.id === category)?.label}
            </span>
            <button className="modal-close" onClick={onClose} title="关闭">×</button>
          </div>
          <div className="settings-main-body">
            {category === "about" && (
              <div className="settings-section">
                <div className="settings-about-hero">
                  <div className="settings-about-icon">AT</div>
                  <div>
                    <div className="settings-about-name">{appName}</div>
                    <div className="settings-about-version">v{appVersion}</div>
                  </div>
                </div>
                <p className="settings-about-desc">
                  一个为 ESP 系列模组(ESP8266 / ESP32)设计的 AT 命令桌面工具,支持脚本化、收藏、模板等特性。
                </p>
                <div className="settings-row">
                  <div className="settings-row-label">项目主页</div>
                  <div className="settings-row-control">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenUrl(GITHUB_REPO_URL)}
                    >
                      打开 GitHub 仓库 ↗
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">反馈问题</div>
                  <div className="settings-row-control">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenUrl(`${GITHUB_REPO_URL}/issues`)}
                    >
                      提交 Issue ↗
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">作者主页</div>
                  <div className="settings-row-control">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenUrl(GITHUB_PROFILE)}
                    >
                      打开 @NingZiXi ↗
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">ESP-AT 官方文档</div>
                  <div className="settings-row-control">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenUrl("https://docs.espressif.com/projects/esp-at/")}
                    >
                      打开文档 ↗
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">许可协议</div>
                  <div className="settings-row-control">
                    <span className="settings-text-mono">MIT</span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">作者</div>
                  <div className="settings-row-control">
                    <a
                      href={GITHUB_PROFILE}
                      onClick={(e) => { e.preventDefault(); handleOpenUrl(GITHUB_PROFILE); }}
                      className="settings-text-mono"
                      style={{ color: "var(--brand)", cursor: "pointer" }}
                    >
                      {AUTHOR_DISPLAY}
                    </a>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">技术栈</div>
                  <div className="settings-row-control">
                    <span className="settings-text-mono">Tauri 2 · React 19 · Rust · TypeScript</span>
                  </div>
                </div>
              </div>
            )}

            {category === "appearance" && (
              <div className="settings-section">
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>主题</div>
                    <div className="settings-row-hint">应用的整体配色风格</div>
                  </div>
                  <div className="settings-row-control">
                    <div className="select-wrap">
                      <select
                        value={settings.themeMode}
                        onChange={(e) => settings.setThemeMode(e.target.value as ThemeMode)}
                        className="field-select"
                      >
                        {THEME_MODES.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <span className="select-arrow">▾</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {category === "general" && (
              <div className="settings-section">
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>默认波特率</div>
                    <div className="settings-row-hint">打开应用时串口下拉框的默认值</div>
                  </div>
                  <div className="settings-row-control">
                    <div className="select-wrap">
                      <select
                        value={settings.defaultBaud}
                        onChange={(e) => settings.setDefaultBaud(Number(e.target.value))}
                        className="field-select"
                      >
                        {BAUDS.map((b) => (
                          <option key={b} value={b}>{b.toLocaleString()}</option>
                        ))}
                      </select>
                      <span className="select-arrow">▾</span>
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>行尾符</div>
                    <div className="settings-row-hint">发送命令时追加的换行符(影响 ESP 解析)</div>
                  </div>
                  <div className="settings-row-control">
                    <div className="select-wrap">
                      <select
                        value={settings.lineEnding}
                        onChange={(e) => settings.setLineEnding(e.target.value as LineEnding)}
                        className="field-select"
                      >
                        {LINE_ENDINGS.map((l) => (
                          <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                      </select>
                      <span className="select-arrow">▾</span>
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>本地回显</div>
                    <div className="settings-row-hint">在终端显示自己发送的命令(便于排错)</div>
                  </div>
                  <div className="settings-row-control">
                    <Toggle value={settings.localEcho} onChange={settings.setLocalEcho} />
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>启动时自动连接</div>
                    <div className="settings-row-hint">记住上次的串口/波特率,启动时自动连接</div>
                  </div>
                  <div className="settings-row-control">
                    <Toggle value={settings.autoConnect} onChange={settings.setAutoConnect} />
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>连接时清空终端</div>
                    <div className="settings-row-hint">新连接建立时清空历史日志</div>
                  </div>
                  <div className="settings-row-control">
                    <Toggle value={settings.clearOnConnect} onChange={settings.setClearOnConnect} />
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>终端日志上限</div>
                    <div className="settings-row-hint">超过该条数时自动丢弃最旧数据(性能保护)</div>
                  </div>
                  <div className="settings-row-control">
                    <input
                      type="number"
                      min={500}
                      max={50000}
                      step={500}
                      value={settings.maxLogCount}
                      onChange={(e) => settings.setMaxLogCount(Number(e.target.value))}
                      className="settings-input-num"
                    />
                    <span className="settings-row-hint" style={{ marginLeft: 6 }}>条</span>
                  </div>
                </div>
              </div>
            )}

            {category === "shortcuts" && (
              <div className="settings-section">
                {SHORTCUT_GROUPS.map((g) => (
                  <div key={g.module} style={{ marginBottom: "var(--spacer-16)" }}>
                    <div className="settings-shortcut-group">{g.module}</div>
                    {g.items.map((it, idx) => (
                      <div key={idx} className="settings-shortcut-row">
                        <kbd className="kbd">{it.keys}</kbd>
                        <span className="settings-shortcut-desc">{it.desc}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="settings-row-hint" style={{ marginTop: "var(--spacer-12)" }}>
                  提示:快捷键自定义功能计划在后续版本中加入。
                </p>
              </div>
            )}

            {category === "data" && (
              <div className="settings-section">
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>导出全部设置</div>
                    <div className="settings-row-hint">将所有偏好/收藏/模板/草稿打包为 JSON</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={exportAll}>
                      导出 JSON
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>导入设置</div>
                    <div className="settings-row-hint">从 JSON 备份恢复(刷新后生效)</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={importAll}>
                      选择文件…
                    </button>
                  </div>
                </div>
                <div className="settings-divider" />
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>清空草稿</div>
                    <div className="settings-row-hint">移除未保存的脚本草稿</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={clearDrafts}>清空</button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>清空步骤模板</div>
                    <div className="settings-row-hint">移除所有已保存的步骤模板</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={clearTemplates}>清空</button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>清空收藏</div>
                    <div className="settings-row-hint">移除所有收藏的 AT 命令和分组</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={clearFavorites}>清空</button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>清空终端历史</div>
                    <div className="settings-row-hint">移除输入框中的命令历史(↑/↓ 切换的内容)</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={clearTerminal}>清空</button>
                  </div>
                </div>
                <div className="settings-divider" />
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div>恢复所有设置为默认</div>
                    <div className="settings-row-hint">仅重置应用偏好,不影响草稿/模板/收藏</div>
                  </div>
                  <div className="settings-row-control">
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      settings.resetDefaults();
                      showToast("ok", "已恢复默认");
                    }}>恢复默认</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {toast && (
          <div className={`settings-toast settings-toast--${toast.kind}`}>{toast.msg}</div>
        )}
      </div>
    </div>
  );
}

/** 简单的开关组件 */
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle ${value ? "is-on" : ""}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="toggle-knob" />
    </button>
  );
}
