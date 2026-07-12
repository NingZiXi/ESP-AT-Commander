import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useSerialStore } from "../stores/serial";
import { useStatsStore } from "../stores/stats";
import { Download, Upload } from "./Icons";

/** 格式化会话时长为 HH:MM:SS */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function StatusBar() {
  const { status, port, baud, connectedAt } = useSerialStore();
  const { txBytes, rxBytes } = useStatsStore();
  const connected = status === "connected";
  const [sessionTime, setSessionTime] = useState("00:00:00");
  const [version, setVersion] = useState("");

  // 读取应用版本号
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  // 会话计时器
  useEffect(() => {
    if (!connected || !connectedAt) {
      setSessionTime("00:00:00");
      return;
    }
    const update = () => {
      setSessionTime(formatDuration(Date.now() - connectedAt));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [connected, connectedAt]);

  return (
    <footer className="status-bar">
      {/* 左侧 */}
      <div className="status-left">
        <div className="status-item">
          <span
            className={`conn-dot ${connected ? "on" : ""}`}
            style={{ width: "6px", height: "6px", borderRadius: "var(--radius-full)" }}
          />
          <span>{connected ? "已连接" : "未连接"}</span>
        </div>
        <div className="status-divider" />
        <span className="status-item">
          <b>{port || "—"}</b>
          {" @ "}
          <b>{baud.toLocaleString()}</b>
          {" baud"}
        </span>
      </div>

      {/* 右侧 */}
      <div className="status-right">
        <div className="status-item">
          <Upload size={12} />
          <span>
            TX: <b>{txBytes.toLocaleString()}</b> bytes
          </span>
        </div>
        <div className="status-item">
          <Download size={12} />
          <span>
            RX: <b>{rxBytes.toLocaleString()}</b> bytes
          </span>
        </div>
        <div className="status-divider" />
        <span className="status-item">
          会话: <b>{sessionTime}</b>
        </span>
        <div className="status-divider" />
        <span className="status-tag">{version ? `v${version}` : "—"}</span>
      </div>
    </footer>
  );
}
