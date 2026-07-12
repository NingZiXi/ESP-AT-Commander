import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSerialStore } from "../stores/serial";
import { useLogsStore } from "../stores/logs";
import { useStatsStore } from "../stores/stats";
import { FavoriteModal } from "./FavoriteModal";
import { Copy, Search, Star } from "./Icons";
import type { AtCommand } from "../types";

interface Props {
  command: AtCommand | null;
  /** 由父组件传入已加载的收藏预设，用于回填参数 */
  presetValues?: Record<string, string> | null;
  onPresetConsumed?: () => void;
}

/** 检查必填参数是否已填 */
function checkRequired(
  command: AtCommand,
  values: Record<string, string>,
): string | null {
  for (const p of command.params) {
    if (p.required && !values[p.id]?.trim()) {
      return `缺少必填参数: ${p.label}`;
    }
  }
  return null;
}

export function ParamForm({ command, presetValues, onPresetConsumed }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFavModal, setShowFavModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const connected = useSerialStore((s) => s.status === "connected");
  const appendLog = useLogsStore((s) => s.append);

  const preview = useMemo(() => {
    if (!command) return "";
    return command.template.replace(
      /\{(\w+)\}/g,
      (_, id: string) => values[id] ?? `{${id}}`,
    );
  }, [command, values]);

  const resetForCommand = (cmd: AtCommand | null) => {
    setValues({});
    setError(null);
    if (cmd) {
      const defaults: Record<string, string> = {};
      for (const p of cmd.params) {
        if (p.default !== undefined) defaults[p.id] = p.default;
      }
      setValues(defaults);
    }
  };

  useEffect(() => {
    resetForCommand(command);
    setShowFavModal(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.id]);

  useEffect(() => {
    if (command && presetValues) {
      setValues(presetValues);
      onPresetConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetValues, command?.id]);

  const handleCopy = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略剪贴板错误 */
    }
  };

  if (!command) {
    return (
      <div className="param-form">
        <div className="param-body">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={24} />
            </div>
            <div className="empty-state-title">未选择命令</div>
            <div className="empty-state-hint">
              从左侧命令树选择一条 AT 指令，或按 <kbd>Ctrl+K</kbd> 搜索
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSend = async () => {
    if (!connected) {
      setError("串口未连接");
      return;
    }
    const missing = checkRequired(command, values);
    if (missing) {
      setError(missing);
      return;
    }
    const finalCmd = preview + "\r\n";
    setSending(true);
    setError(null);
    try {
      appendLog({
        ts: Date.now(),
        dir: "tx",
        type: "raw",
        data: preview,
      });
      await invoke("send_data", { data: finalCmd });
      useStatsStore.getState().incTx(finalCmd.length);
    } catch (err) {
      const msg = typeof err === "string" ? err : "发送失败";
      setError(msg);
      appendLog({
        ts: Date.now(),
        dir: "rx",
        type: "error",
        data: msg,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="param-form">
      <div className="param-body ide-scroll">
        {/* 命令头部 */}
        <div className="cmd-header">
          <div className="cmd-header-row">
            <span className="cmd-header-name">{command.name}</span>
            <span className="cmd-header-desc">{command.summary}</span>
          </div>
          {command.description && (
            <p className="cmd-header-detail">{command.description}</p>
          )}
        </div>

        {/* 模板 */}
        <div className="param-section">
          <div className="section-label">模板</div>
          <div className="template-box">{command.template}</div>
        </div>

        {/* 参数字段 */}
        {command.params.length > 0 && (
          <div className="param-fields">
            {command.params.map((p) => (
              <div className="param-field" key={p.id}>
                <label>
                  {p.label}
                  {p.required && <span className="req"> *</span>}
                </label>
                {p.type === "boolean" ? (
                  <label className="fld-bool">
                    <input
                      type="checkbox"
                      checked={values[p.id] === "1"}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [p.id]: e.target.checked ? "1" : "0",
                        })
                      }
                    />
                    <span>{values[p.id] === "1" ? "启用" : "禁用"}</span>
                  </label>
                ) : p.type === "select" && p.options ? (
                  <select
                    className="param-input"
                    value={values[p.id] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [p.id]: e.target.value })
                    }
                  >
                    <option value="">— 选择 —</option>
                    {p.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="param-input"
                    type={p.type === "password" ? "password" : "text"}
                    value={values[p.id] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [p.id]: e.target.value })
                    }
                    placeholder={p.type === "number" ? "0" : ""}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* 预览 */}
        <div>
          <div className="preview-head">
            <span className="section-label">Preview</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleCopy}
              title="复制命令到剪贴板"
            >
              <Copy size={12} />
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <div className="preview-box">{preview}</div>
        </div>

        {/* 错误提示 */}
        {error && <div className="err-msg">{error}</div>}
      </div>

      {/* 底部操作 */}
      <div className="param-foot">
        <button
          className="btn btn-ghost btn-icon btn-sm"
          title="收藏当前命令和参数预设"
          onClick={() => setShowFavModal(true)}
        >
          <Star size={14} />
        </button>
        <button
          className="btn btn-brand"
          onClick={handleSend}
          disabled={!connected || sending}
          title={connected ? "发送命令" : "请先连接串口"}
        >
          {sending ? "发送中…" : "发送 →"}
        </button>
      </div>

      {showFavModal && (
        <FavoriteModal
          command={command}
          values={values}
          onClose={() => setShowFavModal(false)}
        />
      )}
    </div>
  );
}
