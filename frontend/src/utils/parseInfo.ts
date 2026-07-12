// AT 响应内容解析：从响应行中提取关键信息，展示在气泡下方

interface InfoItem {
  label: string;
  value: string;
}

/** 单行解析规则 */
interface ParseRule {
  re: RegExp;
  extract: (m: RegExpExecArray) => InfoItem[];
}

/** 多行块级解析 */
interface BlockRule {
  re: RegExp;
  extract: (data: string) => InfoItem[];
}

// ────────── 单行规则 ──────────

const LINE_RULES: ParseRule[] = [
  // ========== Basic ==========

  // AT+GMR：固件版本
  {
    re: /^\+GMR:(.+)/,
    extract: (m) => {
      const v = m[1].trim();
      const vm = v.match(/[\d]+\.[\d]+\.[\d]+[\w.]*/);
      return [{ label: "版本", value: vm ? vm[0] : v }];
    },
  },

  // AT+SYSRAM?：剩余内存
  {
    re: /^\+SYSRAM:(\d+)/,
    extract: (m) => [{ label: "RAM", value: `${(Number(m[1]) / 1024).toFixed(1)} KB` }],
  },

  // AT+RFPOWER?：射频功率
  {
    re: /^\+RFPOWER:([\d.]+)/,
    extract: (m) => [{ label: "射频功率", value: `${m[1]} dBm` }],
  },

  // AT+SYSTIMESTAMP?：系统时间戳
  {
    re: /^\+SYSTIMESTAMP:(\d+)/,
    extract: (m) => [
      { label: "时间戳", value: `${m[1]}${m[1].length >= 10 ? ` (${new Date(Number(m[1]) * 1000).toLocaleString()})` : ""}` },
    ],
  },

  // AT+UART_CUR?：当前串口参数
  {
    re: /^\+UART_CUR:(\d+),(\d+),(\d+),(\d+),(\d+)/,
    extract: (m) => [
      { label: "波特率", value: `${Number(m[1]).toLocaleString()}` },
      { label: "配置", value: `${m[2]}N${m[4] === "0" ? "1" : m[4]}` },
    ],
  },

  // AT+SLEEP?：睡眠模式
  {
    re: /^\+SLEEP:(\d+)/,
    extract: (m) => {
      const modes: Record<string, string> = { "0": "禁用", "1": "Modem-sleep", "2": "Light-sleep" };
      return [{ label: "睡眠", value: modes[m[1]] || m[1] }];
    },
  },

  // AT+SYSMSG?：系统提示信息
  {
    re: /^\+SYSMSG:(\d+)/,
    extract: (m) => [{ label: "系统提示", value: m[1] === "0" ? "关闭" : m[1] === "1" ? "仅通知" : "详细" }],
  },

  // ========== Wi-Fi ==========

  // AT+CWMODE?：Wi-Fi 模式
  {
    re: /^\+CWMODE:(\d+)/,
    extract: (m) => {
      const modes: Record<string, string> = { "0": "关闭", "1": "Station", "2": "SoftAP", "3": "Station+AP" };
      return [{ label: "Wi-Fi 模式", value: modes[m[1]] || m[1] }];
    },
  },

  // AT+CWSTATE?（含 SSID 的详细状态）
  {
    re: /^\+CWSTATE:(\d+),?"([^"]*)"/,
    extract: (m) => {
      const states: Record<string, string> = { "0": "未连接", "1": "已连接(未获IP)", "2": "已连接", "3": "重连中", "4": "连接失败" };
      const items: InfoItem[] = [{ label: "Wi-Fi", value: states[m[1]] || m[1] }];
      if (m[2]) items.push({ label: "SSID", value: m[2] });
      return items;
    },
  },

  // AT+CWSTATE?（无 SSID 的简化状态）
  {
    re: /^\+CWSTATE:(\d+)$/,
    extract: (m) => {
      const states: Record<string, string> = { "0": "未连接", "1": "已连接(未获IP)", "2": "已连接", "3": "重连中", "4": "连接失败" };
      return [{ label: "Wi-Fi", value: states[m[1]] || m[1] }];
    },
  },

  // AT+CWJAP?：当前 AP 信息
  {
    re: /^\+CWJAP:"([^"]+)","([^"]+)",(\d+),(-?\d+)/,
    extract: (m) => [
      { label: "Wi-Fi", value: m[1] },
      { label: "MAC", value: m[2] },
      { label: "信道", value: m[3] },
      { label: "RSSI", value: `${m[4]} dBm` },
    ],
  },

  // AT+CWSAP?：SoftAP 配置
  {
    re: /^\+CWSAP:"([^"]+)","([^"]+)",(\d+),(\d+),(\d+)/,
    extract: (m) => {
      const auths: Record<string, string> = { "0": "开放", "1": "WEP", "2": "WPA_PSK", "3": "WPA2_PSK", "4": "WPA_WPA2" };
      return [
        { label: "AP", value: m[1] },
        { label: "信道", value: m[3] },
        { label: "认证", value: auths[m[4]] || m[4] },
        { label: "最大连接", value: m[5] },
      ];
    },
  },

  // AT+CWDHCP?：DHCP 状态
  {
    re: /^\+CWDHCP:(\d+),(\d+)/,
    extract: (m) => {
      const modes: Record<string, string> = { "0": "SoftAP", "1": "Station", "2": "两者" };
      return [
        { label: "DHCP", value: modes[m[1]] || m[1] },
        { label: "状态", value: m[2] === "1" ? "已启用" : "已禁用" },
      ];
    },
  },

  // AT+CWAUTOCONN?：自动连接
  {
    re: /^\+CWAUTOCONN:(\d+)/,
    extract: (m) => [{ label: "自动连接", value: m[1] === "1" ? "开启" : "关闭" }],
  },

  // AT+CIPSTAMAC?：STA MAC
  {
    re: /^\+CIPSTAMAC:"([^"]+)"/,
    extract: (m) => [{ label: "STA MAC", value: m[1] }],
  },

  // AT+CIPAPMAC?：AP MAC
  {
    re: /^\+CIPAPMAC:"([^"]+)"/,
    extract: (m) => [{ label: "AP MAC", value: m[1] }],
  },

  // +CIFSR 系列
  {
    re: /^\+CIFSR:STAIP,"([^"]+)"/,
    extract: (m) => [{ label: "IP", value: m[1] }],
  },
  {
    re: /^\+CIFSR:STAMAC,"([^"]+)"/,
    extract: (m) => [{ label: "MAC", value: m[1] }],
  },
  {
    re: /^\+CIFSR:STAIP6,"([^"]+)"/,
    extract: (m) => [{ label: "IPv6", value: m[1] }],
  },
  {
    re: /^\+CIFSR:APIP,"([^"]+)"/,
    extract: (m) => [{ label: "AP IP", value: m[1] }],
  },
  {
    re: /^\+CIFSR:APMAC,"([^"]+)"/,
    extract: (m) => [{ label: "AP MAC", value: m[1] }],
  },

  // +CIPSTA 系列：STA IP 配置
  {
    re: /^\+CIPSTA:ip:"([^"]+)"/,
    extract: (m) => [{ label: "IP", value: m[1] }],
  },
  {
    re: /^\+CIPSTA:gateway:"([^"]+)"/,
    extract: (m) => [{ label: "网关", value: m[1] }],
  },
  {
    re: /^\+CIPSTA:netmask:"([^"]+)"/,
    extract: (m) => [{ label: "子网掩码", value: m[1] }],
  },
  {
    re: /^\+CIPSTA:mac:"([^"]+)"/,
    extract: (m) => [{ label: "MAC", value: m[1] }],
  },

  // +CIPAP 系列：SoftAP IP 配置
  {
    re: /^\+CIPAP:ip:"([^"]+)"/,
    extract: (m) => [{ label: "AP IP", value: m[1] }],
  },
  {
    re: /^\+CIPAP:gateway:"([^"]+)"/,
    extract: (m) => [{ label: "AP 网关", value: m[1] }],
  },
  {
    re: /^\+CIPAP:netmask:"([^"]+)"/,
    extract: (m) => [{ label: "AP 掩码", value: m[1] }],
  },

  // +CWHOSTNAME：主机名
  {
    re: /^\+CWHOSTNAME:"([^"]+)"/,
    extract: (m) => [{ label: "主机名", value: m[1] }],
  },

  // ========== TCP/IP ==========

  // AT+CIPSTATUS：连接状态
  {
    re: /^\+CIPSTATUS:(\d+)/,
    extract: (m) => {
      const statuses: Record<string, string> = {
        "0": "未初始化", "1": "单连接模式", "2": "多连接模式",
        "3": "已连接", "4": "已断开", "5": "WiFi 未初始化",
      };
      return [{ label: "状态", value: statuses[m[1]] || m[1] }];
    },
  },

  // +CIPSTATUS 详细连接列表行：+CIPSTATUS:<link_id>,<type>,<remote_ip>,<remote_port>,<local_port>,<tetype>
  {
    re: /^\+CIPSTATUS:(\d+),(TCP|UDP|SSL),"([^"]+)",(\d+),(\d+)/,
    extract: (m) => [{ label: `连接 ${m[1]}`, value: `${m[2]} ${m[3]}:${m[4]}` }],
  },

  // AT+CIPDOMAIN?：DNS 解析
  {
    re: /^\+CIPDOMAIN:"([^"]+)","([^"]+)"/,
    extract: (m) => [{ label: "DNS", value: `${m[1]} → ${m[2]}` }],
  },

  // AT+CIPMUX?：多连接模式
  {
    re: /^\+CIPMUX:(\d+)/,
    extract: (m) => [{ label: "多连接", value: m[1] === "1" ? "已启用" : "已禁用" }],
  },

  // AT+CIPMODE?：传输模式
  {
    re: /^\+CIPMODE:(\d+)/,
    extract: (m) => [{ label: "传输模式", value: m[1] === "1" ? "透传模式" : "普通模式" }],
  },

  // AT+CIPSERVER：服务器信息
  {
    re: /^\+CIPSERVER:(\d+),(\d+)/,
    extract: (m) => [{ label: "服务器", value: m[1] === "1" ? `端口 ${m[2]}` : "已删除" }],
  },

  // AT+CIPSTO?：超时时间
  {
    re: /^\+CIPSTO:(\d+)/,
    extract: (m) => [{ label: "超时", value: `${m[1]} 秒` }],
  },

  // AT+CIPSNTPCFG?：SNTP 配置
  {
    re: /^\+CIPSNTPCFG:(-?\d+),(\d+),?"([^"]*)"/,
    extract: (m) => {
      const items: InfoItem[] = [{ label: "时区", value: `UTC${Number(m[1]) >= 0 ? "+" : ""}${m[1]}` }];
      if (m[3]) items.push({ label: "NTP 服务器", value: m[3] });
      return items;
    },
  },

  // AT+CIPSNTPTIME?：NTP 时间
  {
    re: /^\+CIPSNTPTIME:(.+)/,
    extract: (m) => [{ label: "NTP 时间", value: m[1].trim() }],
  },

  // AT+PING 响应
  {
    re: /^\+(\d+|timeout)/i,
    extract: (m) => {
      if (m[1].toLowerCase() === "timeout") return [{ label: "Ping", value: "超时" }];
      return [{ label: "Ping", value: `${m[1]} ms` }];
    },
    // 注意：ping 的实际响应格式是 "+12" 或 "+timeout"，
    // 这个规则需要排到最后以避免误匹配，但通过特殊标记处理
  },
  // 更精确的 ping 匹配
  {
    re: /^\+(\d{1,5})$/,
    extract: (m) => [{ label: "Ping", value: `${m[1]} ms` }],
  },

  // AT+CIPDNS?：DNS 服务器
  {
    re: /^\+CIPDNS:(\d+)/,
    extract: (m) => [{ label: "DNS 自动获取", value: m[1] === "1" ? "已启用" : "已禁用" }],
  },
  {
    re: /^\+CIPDNS:(\d+),"([^"]+)"/,
    extract: (m) => [{ label: "DNS", value: `${m[1] === "1" ? "自动" : "手动"} ${m[2]}` }],
  },

  // ALREADY CONNECTED / CONNECT / CLOSED
  {
    re: /^ALREADY CONNECTED/,
    extract: () => [{ label: "连接", value: "已存在连接" }],
  },
  {
    re: /^CONNECT$/,
    extract: () => [{ label: "连接", value: "建立成功" }],
  },
  {
    re: /^CLOSED$/,
    extract: () => [{ label: "连接", value: "已关闭" }],
  },

  // ========== MQTT ==========

  // AT+MQTTUSERCFG?：MQTT 用户配置
  {
    re: /^\+MQTTUSERCFG:(\d+),(\d+),?"([^"]*)",?"([^"]*)"/,
    extract: (m) => {
      const items: InfoItem[] = [{ label: "Client ID", value: m[3] || "(空)" }];
      if (m[4]) items.push({ label: "用户名", value: m[4] });
      return items;
    },
  },

  // AT+MQTTCONNCFG?：MQTT 连接配置
  {
    re: /^\+MQTTCONNCFG:\d+,\d+,\d+,(\d+)/,
    extract: (m) => [{ label: "MQTT 心跳", value: `${m[1]} 秒` }],
  },

  // +MQTTCONNECTED
  {
    re: /^\+MQTTCONNECTED:\d+,"([^"]+)",(\d+)/,
    extract: (m) => [{ label: "MQTT", value: `已连接 ${m[1]}:${m[2]}` }],
  },

  // +MQTTDISCONNECTED
  {
    re: /^\+MQTTDISCONNECTED:\d+/,
    extract: () => [{ label: "MQTT", value: "已断开" }],
  },

  // +MQTTSUBRECV
  {
    re: /^\+MQTTSUBRECV:\d+,"([^"]+)",\d+,(.+)/,
    extract: (m) => [{ label: "MQTT 订阅", value: `${m[1]} → ${m[2]}` }],
  },

  // +MQTTPUB
  {
    re: /^\+MQTTPUB:\d+/,
    extract: () => [{ label: "MQTT", value: "发布成功" }],
  },

  // ========== HTTP ==========

  // AT+HTTPCLIENT 响应
  {
    re: /^\+HTTPCLIENT:(\d+),(\d+)/,
    extract: (m) => [
      { label: "HTTP", value: `${m[1]} 字节` },
      { label: "状态码", value: m[2] },
    ],
  },

  // AT+HTTPGETSIZE 响应
  {
    re: /^\+HTTPGETSIZE:(\d+)/,
    extract: (m) => [{ label: "资源大小", value: `${Number(m[1]).toLocaleString()} 字节` }],
  },

  // ========== BLE ==========

  // AT+BLEINIT?：BLE 模式
  {
    re: /^\+BLEINIT:(\d+)/,
    extract: (m) => {
      const modes: Record<string, string> = { "0": "未初始化", "1": "Client", "2": "Server" };
      return [{ label: "BLE", value: modes[m[1]] || m[1] }];
    },
  },

  // AT+BLEADDR?：BLE 地址
  {
    re: /^\+BLEADDR:(\d+),(\d+),"([^"]+)"/,
    extract: (m) => {
      const types: Record<string, string> = { "0": "Public", "1": "Random" };
      return [{ label: "BLE 地址", value: `${m[3]} (${types[m[2]] || m[2]})` }];
    },
  },

  // AT+BLENAME?：BLE 名称
  {
    re: /^\+BLENAME:"([^"]+)"/,
    extract: (m) => [{ label: "BLE 名称", value: m[1] }],
  },

  // +BLESCAN 扫描结果
  {
    re: /^\+BLESCAN:"([^"]+)","([^"]+)",(-?\d+)/,
    extract: (m) => [
      { label: "BLE 设备", value: m[1] },
      { label: "信号", value: `${m[3]} dBm` },
    ],
  },

  // AT+BLEADVPARAM?：广播参数
  {
    re: /^\+BLEADVPARAM:(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/,
    extract: (m) => [
      { label: "广播间隔", value: `${(Number(m[1]) * 0.625).toFixed(1)}~${(Number(m[2]) * 0.625).toFixed(1)} ms` },
    ],
  },

  // 通用 + 前缀事件（放在最后做兜底）
  {
    re: /^(WIFI CONNECTED|WIFI GOT IP|WIFI GOT IPv6|WIFI DISCONNECT|WIFI CONNECT FAIL|SMART CONNECTED|SMARTCONFIG FINISHED)/,
    extract: (m) => {
      const labels: Record<string, string> = {
        "WIFI CONNECTED": "Wi-Fi 已连接",
        "WIFI GOT IP": "已获取 IP",
        "WIFI GOT IPv6": "已获取 IPv6",
        "WIFI DISCONNECT": "Wi-Fi 已断开",
        "WIFI CONNECT FAIL": "Wi-Fi 连接失败",
        "SMART CONNECTED": "SmartConfig 成功",
        "SMARTCONFIG FINISHED": "SmartConfig 完成",
      };
      return [{ label: "事件", value: labels[m[1]] || m[1] }];
    },
  },

  // Busy / ready
  {
    re: /^busy p (\d+)/,
    extract: (m) => [{ label: "Busy", value: `处理中 (${m[1]})` }],
  },
  {
    re: /^ready/,
    extract: () => [{ label: "系统", value: "就绪" }],
  },

  // SEND OK / SEND FAIL
  {
    re: /^SEND OK/,
    extract: () => [{ label: "发送", value: "成功" }],
  },
  {
    re: /^SEND FAIL/,
    extract: () => [{ label: "发送", value: "失败" }],
  },
];

// ────────── 多行块级规则 ──────────

const BLOCK_RULES: BlockRule[] = [
  // +CWLAP 多行 Wi-Fi 扫描
  {
    re: /\+CWLAP:\((\d+),"([^"]+)",(-?\d+),/,
    extract: (data: string) => {
      const results: InfoItem[] = [];
      let count = 0;
      const re = /\((\d+),"([^"]+)",(-?\d+),/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(data)) !== null) {
        count++;
      }
      if (count > 0) {
        let bestRssi = -999;
        let bestSsid = "";
        const re2 = /\((\d+),"([^"]+)",(-?\d+),/g;
        while ((m = re2.exec(data)) !== null) {
          const rssi = parseInt(m[3], 10);
          if (rssi > bestRssi) {
            bestRssi = rssi;
            bestSsid = m[2];
          }
        }
        results.push({ label: "Wi-Fi 扫描", value: `找到 ${count} 个网络` });
        results.push({ label: "最强信号", value: `${bestSsid} (${bestRssi} dBm)` });
      }
      return results;
    },
  },

  // +IPD 接收数据块
  {
    re: /^\+IPD,(\d+):/m,
    extract: (data: string) => {
      const m = data.match(/^\+IPD,(\d+):/);
      if (m) return [{ label: "IPD 数据", value: `${m[1]} 字节` }];
      return [];
    },
  },

  // +CIFSR 多行输出聚合
  {
    re: /\+CIFSR:/,
    extract: (data: string) => {
      const ips: string[] = [];
      const re = /\+CIFSR:(STAIP|APIP|STAIP6),?"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(data)) !== null) {
        ips.push(m[2]);
      }
      if (ips.length > 1) return [{ label: "IP 地址", value: ips.join(" / ") }];
      return [];
    },
  },

  // +CWJAP? 完整返回（含 SSID + MAC + 信道 + RSSI 多行情况）
  {
    re: /\+CWJAP:"[^"]+","[^"]+",\d+,/,
    extract: (data: string) => {
      const m = data.match(/^\+CWJAP:"([^"]+)","([^"]+)",(\d+),(-?\d+)/m);
      if (m) return [{ label: "已连接 Wi-Fi", value: `${m[1]} (${m[4]} dBm, CH ${m[3]})` }];
      return [];
    },
  },
];

/** 从接收缓冲区提取信息 */
export function extractInfo(lines: string[]): InfoItem[] {
  const results: InfoItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    for (const rule of LINE_RULES) {
      const m = rule.re.exec(line);
      if (m) {
        const items = rule.extract(m);
        for (const item of items) {
          const key = `${item.label}:${item.value}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push(item);
          }
        }
        break;
      }
    }
  }

  // 块级匹配（对整个 buffer 做一次匹配）
  const data = lines.join("\n");
  for (const rule of BLOCK_RULES) {
    if (rule.re.test(data)) {
      const items = rule.extract(data);
      for (const item of items) {
        const key = `${item.label}:${item.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(item);
        }
      }
    }
  }

  return results;
}
