// 共享类型定义（与 Rust serde 对齐）

/** Terminal 日志条目 */
export interface LogEntry {
  id: number; // 自增唯一 ID，用于 React key
  ts: number;
  dir: "tx" | "rx";
  type: "raw" | "ok" | "error" | "event" | "warning";
  data: string;
  /** 从 AT 响应中提取的 key-value 信息（如 IP、版本等） */
  info?: { label: string; value: string }[];
}

/** 串口参数 */
export interface SerialConfig {
  port: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "odd" | "even";
  flowControl: "none" | "software" | "hardware";
}

/** 命令参数定义 */
export interface CommandParam {
  id: string;
  label: string;
  type: "string" | "password" | "number" | "select" | "boolean";
  required?: boolean;
  options?: string[];
  default?: string;
}

/** AT 命令定义 */
export interface AtCommand {
  id: string;
  name: string;
  summary: string;
  description?: string;
  template: string;
  params: CommandParam[];
  responses?: string[];
}

/** 命令分类 */
export interface CommandCategory {
  id: string;
  name: string;
  icon?: string;
  commands: AtCommand[];
}

/** 串口连接状态 */
export type ConnectionStatus = "disconnected" | "connecting" | "connected";
