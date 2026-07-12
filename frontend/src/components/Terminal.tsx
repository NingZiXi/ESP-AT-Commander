import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useSerialStore } from "../stores/serial";
import { useLogsStore } from "../stores/logs";
import { useParserStore } from "../stores/parser";
import { useStatsStore } from "../stores/stats";
import { useHistoryStore } from "../stores/history";
import { ArrowDown, Power, Save, Search, Terminal as TerminalIcon, Trash } from "./Icons";
import type { LogEntry } from "../types";
import { extractInfo } from "../utils/parseInfo";

/** 格式化时间戳 HH:MM:SS */
function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 日志导出为纯文本 */
function logsToText(logs: LogEntry[]): string {
  return logs
    .map((l) => `[${formatTs(l.ts)}] ${l.dir.toUpperCase()}\t${l.data}`)
    .join("\n");
}

/** 根据日志类型返回 mark 样式名和标签 */
function getMark(log: LogEntry): { cls: string; label: string } {
  if (log.dir === "tx") return { cls: "term-mark--tx", label: "TX" };
  switch (log.type) {
    case "ok":
      return { cls: "term-mark--ok", label: "OK" };
    case "error":
      return { cls: "term-mark--err", label: "ERR" };
    case "event":
      return { cls: "term-mark--evt", label: "EVT" };
    case "warning":
      return { cls: "term-mark--warn", label: "WARN" };
    default:
      return { cls: "term-mark--rx", label: "RX" };
  }
}

export function Terminal() {
  const { logs, appendMany, clear } = useLogsStore();
  const { status, setStatus, setError } = useSerialStore();
  const connected = status === "connected";
  const { loaded, load, classify } = useParserStore();
  const { incTx, incRx, reset: resetStats } = useStatsStore();
  const { items: history, add: addHistory } = useHistoryStore();
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [logFilter, setLogFilter] = useState("");
  const [collapsedInfo, setCollapsedInfo] = useState<Set<number>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);
  const rxBatchRef = useRef<string>("");
  const rxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const histIdxRef = useRef<number>(-1);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // 监听串口接收事件 — 用 debounce 将短时间内到达的数据合并为一个气泡
  useEffect(() => {
    let currentBytes = 0;

    const flushBatch = () => {
      const data = rxBatchRef.current.trimEnd();
      if (!data) return;
      rxBatchRef.current = "";
      rxTimerRef.current = null;
      // 取最后一行进行类型分类
      const lines = data.split("\n").map((l) => l.replace(/\r$/, ""));
      const lastLine = lines[lines.length - 1] || "";
      const type = classify(lastLine);
      const info = extractInfo(lines);
      appendMany([{ ts: Date.now(), dir: "rx", type, data, info }]);
      incRx(type, currentBytes);
      currentBytes = 0;
    };

    const unlistenRx = listen<string>("serial://rx", (event) => {
      rxBatchRef.current += event.payload;
      currentBytes += event.payload.length;
      if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
      rxTimerRef.current = setTimeout(flushBatch, 100);
    });

    // 监听串口意外断开 / 重连事件
    const unlistenDisc = listen<string>("serial://disconnected", (event) => {
      const msg = event.payload || "串口连接已断开";
      if (status === "connected") {
        // 重连过程中不改为 disconnected，只添加日志
        appendMany([{
          ts: Date.now(),
          dir: "rx",
          type: "error",
          data: msg.startsWith("串口 ") ? `⚠ ${msg}` : `⚠ 串口连接已断开`,
        }]);
      }
    });

    const unlistenReconn = listen<string>("serial://reconn-progress", (event) => {
      appendMany([{
        ts: Date.now(),
        dir: "rx",
        type: "warning",
        data: `⟳ ${event.payload}`,
      }]);
    });

    const unlistenReconnected = listen<string>("serial://reconnected", (event) => {
      rxBatchRef.current = "";
      if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
      rxTimerRef.current = null;
      setStatus("connected");
      appendMany([{
        ts: Date.now(),
        dir: "rx",
        type: "ok",
        data: `✓ ${event.payload}`,
      }]);
    });

    const unlistenReconnFail = listen("serial://reconn-failed", () => {
      setStatus("disconnected");
      setError("串口连接已断开");
      rxBatchRef.current = "";
      if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
      rxTimerRef.current = null;
    });

    return () => {
      unlistenRx.then((un) => un());
      unlistenDisc.then((un) => un());
      unlistenReconn.then((un) => un());
      unlistenReconnected.then((un) => un());
      unlistenReconnFail.then((un) => un());
      if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
      rxTimerRef.current = null;
    };
  }, [appendMany, classify, incRx, status, setStatus, setError]);

  const filtered = logFilter.trim()
    ? logs.filter((l) => l.data.toLowerCase().includes(logFilter.toLowerCase()))
    : logs;

  /** 高亮匹配关键字 */
  function highlightText(text: string, keyword: string) {
    if (!keyword.trim()) return text;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase()
        ? <mark className="search-highlight" key={i}>{part}</mark>
        : part
    );
  }

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleSend = async () => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    appendMany([{ ts: Date.now(), dir: "tx", type: "raw", data: cmd }]);
    incTx(cmd.length + 2);
    try {
      await invoke("send_data", { data: cmd + "\r\n" });
      addHistory(cmd);
      setInput("");
      histIdxRef.current = -1;
    } catch (err) {
      appendMany([
        {
          ts: Date.now(),
          dir: "rx",
          type: "error",
          data: typeof err === "string" ? err : "发送失败",
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (history.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = histIdxRef.current === -1
          ? history.length - 1
          : Math.max(0, histIdxRef.current - 1);
        histIdxRef.current = next;
        setInput(history[next] ?? "");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdxRef.current === -1) return;
        const next = histIdxRef.current + 1;
        if (next >= history.length) {
          histIdxRef.current = -1;
          setInput("");
        } else {
          histIdxRef.current = next;
          setInput(history[next] ?? "");
        }
      } else if (e.key === "Escape") {
        histIdxRef.current = -1;
        setInput("");
      }
    }
  };

  const handleClear = () => {
    clear();
    resetStats();
    rxBatchRef.current = "";
    if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
    rxTimerRef.current = null;
  };

  const handleExport = async () => {
    if (logs.length === 0) return;
    try {
      const filePath = await save({
        defaultPath: `esp-at-logs-${Date.now()}.txt`,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (filePath) {
        await invoke("save_logs", { content: logsToText(logs), path: filePath });
      }
    } catch (err) {
      console.error("导出失败:", err);
    }
  };

  return (
    <section className="terminal">
      {/* 终端工具栏 */}
      <div className="tbar">
        <div className="tbar-left">
          <TerminalIcon size={14} />
          <span className="tbar-title">终端</span>
        </div>
        <div className="tbar-right">
          <div className="tbar-search">
            <input
              className="tbar-search-input"
              placeholder="过滤日志…"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
            />
            {logFilter && (
              <button
                className="search-clear"
                onClick={() => setLogFilter("")}
                title="清空过滤"
              >
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleExport}
            title="保存日志"
            disabled={logs.length === 0}
          >
            <Save size={14} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleClear}
            title="清空"
            disabled={logs.length === 0}
          >
            <Trash size={14} />
          </button>
          <button
            className={`btn btn-ghost btn-icon btn-sm ${autoScroll ? "active" : ""}`}
            onClick={() => setAutoScroll((v) => !v)}
            title="自动滚动"
          >
            <ArrowDown size={14} />
          </button>
        </div>
      </div>

      {/* 终端内容 */}
      <div className="tbody ide-scroll" ref={bodyRef}>
        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              {logFilter.trim() ? <Search size={24} /> : connected ? <TerminalIcon size={24} /> : <Power size={24} />}
            </div>
            <div className="empty-state-title">
              {logFilter.trim()
                ? "无匹配日志"
                : connected
                  ? "等待数据"
                  : "未连接串口"}
            </div>
            <div className="empty-state-hint">
              {logFilter.trim()
                ? "尝试其他关键词"
                : connected
                  ? "发送的命令和接收的数据将显示在此处"
                  : "请在顶部选择串口并点击 Connect 按钮连接设备"}
            </div>
          </div>
        )}
        {filtered.map((log) => {
          const mark = getMark(log);
          const isTx = log.dir === "tx";
          const hasInfo = log.info && log.info.length > 0;
          const isCollapsed = collapsedInfo.has(log.id);
          return (
            <div className={`term-line ${isTx ? "term-line--tx" : "term-line--rx"}`} key={log.id}>
              <div className="term-bubble-wrap">
                <div className="term-bubble-meta">
                  <span className={`term-mark ${mark.cls}`}>{mark.label}</span>
                  <span className="term-time">{formatTs(log.ts)}</span>
                </div>
                <div className={`term-bubble ${isTx ? "term-bubble--tx" : `term-bubble--rx ${mark.cls}`}`}>
                  <div className="term-bubble-text">{highlightText(log.data, logFilter)}</div>
                  {hasInfo && !isCollapsed && (
                    <div className="term-info">
                      {log.info!.map((item, i) => (
                        <div className="term-info-row" key={i}>
                          <span className="term-info-label">{item.label}</span>
                          <span className="term-info-value">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {hasInfo && (
                    <button
                      className={`term-bubble-toggle ${isCollapsed ? "" : "is-expanded"}`}
                      onClick={() =>
                        setCollapsedInfo((prev) => {
                          const next = new Set(prev);
                          if (next.has(log.id)) next.delete(log.id);
                          else next.add(log.id);
                          return next;
                        })
                      }
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10">
                        <path d="M2 3.5 L5 7 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 图例栏 */}
      <div className="legend-bar">
        <div className="legend-item">
          <span className="legend-dot legend-dot--tx" />
          <span className="legend-text">TX</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-dot--rx" />
          <span className="legend-text">RX</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-dot--ok" />
          <span className="legend-text">OK</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-dot--err" />
          <span className="legend-text">Error</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-dot--evt" />
          <span className="legend-text">Event</span>
        </div>
      </div>

      {/* 输入栏 */}
      <div className="input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? "输入 AT 命令..." : "未连接"}
          disabled={!connected}
        />
        <button
          className="btn btn-brand btn-sm"
          onClick={handleSend}
          disabled={!connected || !input.trim()}
        >
          发送
        </button>
      </div>
    </section>
  );
}
