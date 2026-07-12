// ESP-AT Commander 后端入口

use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};

/// 串口信息
#[derive(Serialize)]
pub struct PortInfo {
    pub name: String,
    pub product: Option<String>,
}

/// 应用全局状态：持有写入端 + 读取线程控制 + 脚本取消标志 + 共享 RX buffer
pub struct AppState {
    writer: Mutex<Option<Box<dyn SerialPort>>>,
    running: Arc<AtomicBool>,
    reader_thread: Mutex<Option<thread::JoinHandle<()>>>,
    script_cancel: Arc<AtomicBool>,
    /// 共享 RX buffer：读取线程追加数据，脚本 wait 轮询匹配
    rx_buffer: Arc<Mutex<String>>,
    /// 最近一次连接参数（用于自动重连）
    last_port: Mutex<Option<String>>,
    last_baud: Mutex<Option<u32>>,
    last_data_bits: Mutex<Option<u8>>,
    last_stop_bits: Mutex<Option<u8>>,
    last_parity: Mutex<Option<u8>>,
}

/// 用系统默认浏览器/应用打开外部 URL
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开 URL 失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开 URL 失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开 URL 失败: {}", e))?;
    }
    Ok(())
}

/// 串口数据位
#[derive(Debug, Clone, Copy, Deserialize)]
pub enum DataBits {
    Five,
    Six,
    Seven,
    Eight,
}

impl DataBits {
    fn to_serial(self) -> serialport::DataBits {
        match self {
            DataBits::Five => serialport::DataBits::Five,
            DataBits::Six => serialport::DataBits::Six,
            DataBits::Seven => serialport::DataBits::Seven,
            DataBits::Eight => serialport::DataBits::Eight,
        }
    }
}

/// 串口停止位
#[derive(Debug, Clone, Copy, Deserialize)]
pub enum StopBits {
    One,
    Two,
}

impl StopBits {
    fn to_serial(self) -> serialport::StopBits {
        match self {
            StopBits::One => serialport::StopBits::One,
            StopBits::Two => serialport::StopBits::Two,
        }
    }
}

/// 串口校验位
#[derive(Debug, Clone, Copy, Deserialize)]
pub enum Parity {
    None,
    Odd,
    Even,
}

impl Parity {
    fn to_serial(self) -> serialport::Parity {
        match self {
            Parity::None => serialport::Parity::None,
            Parity::Odd => serialport::Parity::Odd,
            Parity::Even => serialport::Parity::Even,
        }
    }
}

/// 枚举系统可用的串口列表
#[tauri::command]
fn list_ports() -> Result<Vec<PortInfo>, String> {
    serialport::available_ports()
        .map_err(|e| format!("枚举串口失败: {}", e))
        .map(|ports| {
            ports
                .into_iter()
                .map(|p| PortInfo {
                    name: p.port_name,
                    product: match p.port_type {
                        serialport::SerialPortType::UsbPort(usb) => usb.product,
                        serialport::SerialPortType::BluetoothPort => Some("Bluetooth".into()),
                        serialport::SerialPortType::PciPort => Some("PCI".into()),
                        serialport::SerialPortType::Unknown => None,
                    },
                })
                .collect()
        })
}

/// 连接串口并启动后台读取线程
/// data_bits: 5/6/7/8（默认 8）；stop_bits: 1/2（默认 1）；parity: None/Odd/Even（默认 None）
#[tauri::command]
fn connect_port(
    port: String,
    baud_rate: u32,
    state: tauri::State<AppState>,
    app: AppHandle,
    data_bits: Option<DataBits>,
    stop_bits: Option<StopBits>,
    parity: Option<Parity>,
) -> Result<(), String> {
    let db = data_bits.unwrap_or(DataBits::Eight);
    let sb = stop_bits.unwrap_or(StopBits::One);
    let pa = parity.unwrap_or(Parity::None);

    let writer = serialport::new(&port, baud_rate)
        .timeout(Duration::from_millis(100))
        .data_bits(db.to_serial())
        .stop_bits(sb.to_serial())
        .parity(pa.to_serial())
        .open()
        .map_err(|e| format!("打开 {} 失败: {}", port, e))?;

    let mut reader = writer
        .try_clone()
        .map_err(|e| format!("克隆串口句柄失败: {}", e))?;

    // 保存重连参数
    if let Ok(mut p) = state.last_port.lock() { *p = Some(port.clone()); }
    if let Ok(mut b) = state.last_baud.lock() { *b = Some(baud_rate); }
    if let Ok(mut d) = state.last_data_bits.lock() { *d = Some(db as u8); }
    if let Ok(mut s) = state.last_stop_bits.lock() { *s = Some(sb as u8); }
    if let Ok(mut pa_lock) = state.last_parity.lock() { *pa_lock = Some(pa as u8); }

    // 新连接：清空 RX buffer（旧数据对本次连接无意义）
    if let Ok(mut rx) = state.rx_buffer.lock() {
        rx.clear();
    }

    // 启动读取线程
    state.running.store(true, Ordering::SeqCst);
    let running = state.running.clone();
    let rx_buffer = state.rx_buffer.clone();
    let app_for_thread = app.clone();
    let port_clone = port.clone();
    let baud_clone = baud_rate;
    let db_clone = db;
    let sb_clone = sb;
    let pa_clone = pa;

    let handle = thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while running.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 追加到共享 RX buffer，供脚本 wait 匹配
                    if let Ok(mut rx) = rx_buffer.lock() {
                        rx.push_str(&data);
                        // 限制 buffer 上限 64KB，避免无限增长（保留最新数据）
                        if rx.len() > 65536 {
                            let drop_len = rx.len() - 65536;
                            rx.drain(0..drop_len);
                        }
                    }
                    let _ = app.emit("serial://rx", data);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(_) => break,
            }
        }
        // 读取线程退出 — 判断是否为意外断开
        if running.load(Ordering::SeqCst) {
            // 仍然是 running 状态 = 意外断开，尝试自动重连
            auto_reconnect(&app_for_thread, &port_clone, baud_clone, db_clone, sb_clone, pa_clone, &running);
        } else {
            // 用户主动断开 = 通知前端
            let _ = app_for_thread.emit("serial://disconnected", ());
        }
    });

    let mut writer_guard = state.writer.lock().map_err(|e| e.to_string())?;
    *writer_guard = Some(writer);
    let mut thread_guard = state.reader_thread.lock().map_err(|e| e.to_string())?;
    *thread_guard = Some(handle);
    Ok(())
}

/// 自动重连：尝试重新打开串口，最多 5 次，间隔递增
fn auto_reconnect(
    app: &AppHandle,
    port: &str,
    baud: u32,
    data_bits: DataBits,
    stop_bits: StopBits,
    parity: Parity,
    running: &Arc<AtomicBool>,
) {
    let _ = app.emit("serial://disconnected", format!("串口 {} 已断开，正在尝试重连…", port));

    for attempt in 1..=5 {
        if !running.load(Ordering::SeqCst) {
            let _ = app.emit("serial://disconnected", "串口已断开");
            return;
        }
        thread::sleep(Duration::from_millis(500 * attempt));

        match serialport::new(port, baud)
            .timeout(Duration::from_millis(100))
            .data_bits(data_bits.to_serial())
            .stop_bits(stop_bits.to_serial())
            .parity(parity.to_serial())
            .open()
        {
            Ok(writer) => {
                let reader = match writer.try_clone() {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                let state = app.state::<AppState>();
                if let Ok(mut guard) = state.writer.lock() {
                    *guard = Some(writer);
                }

                // 重新启动读取线程
                let running_clone = running.clone();
                let rx_buffer = state.rx_buffer.clone();
                let app_clone = app.clone();
                let port_owned = port.to_string();
                let baud_copy = baud;
                let db_copy = data_bits;
                let sb_copy = stop_bits;
                let pa_copy = parity;

                let handle = thread::spawn(move || {
                    let mut reader = reader;
                    let mut buf = [0u8; 1024];
                    while running_clone.load(Ordering::SeqCst) {
                        match reader.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                                if let Ok(mut rx) = rx_buffer.lock() {
                                    rx.push_str(&data);
                                    if rx.len() > 65536 {
                                        let drop_len = rx.len() - 65536;
                                        rx.drain(0..drop_len);
                                    }
                                }
                                let _ = app_clone.emit("serial://rx", data);
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                            Err(_) => break,
                        }
                    }
                    if running_clone.load(Ordering::SeqCst) {
                        auto_reconnect(&app_clone, &port_owned, baud_copy, db_copy, sb_copy, pa_copy, &running_clone);
                    } else {
                        let _ = app_clone.emit("serial://disconnected", ());
                    }
                });
                if let Ok(mut thread_guard) = state.reader_thread.lock() {
                    *thread_guard = Some(handle);
                }

                let _ = app.emit("serial://reconnected", format!("已重新连接 {} (第 {} 次尝试)", port, attempt));
                return;
            }
            Err(_) => {
                let _ = app.emit("serial://reconn-progress", format!("重连尝试 {}/5 失败…", attempt));
            }
        }
    }

    // 全部重连失败
    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.writer.lock() { *guard = None; }
    running.store(false, Ordering::SeqCst);
    let _ = app.emit("serial://disconnected", "串口已断开（重连失败）");
    // 通知前端更新状态为 disconnected
    let _ = app.emit("serial://reconn-failed", ());
}

/// 断开串口：停止读取线程 + 关闭写入端
#[tauri::command]
fn disconnect_port(state: tauri::State<AppState>) -> Result<(), String> {
    state.running.store(false, Ordering::SeqCst);
    // 清空 RX buffer
    if let Ok(mut rx) = state.rx_buffer.lock() {
        rx.clear();
    }
    let mut writer_guard = state.writer.lock().map_err(|e| e.to_string())?;
    let _ = writer_guard.take();
    let mut thread_guard = state.reader_thread.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = thread_guard.take() {
        let _ = handle.join();
    }
    Ok(())
}

/// 查询当前连接状态
#[tauri::command]
fn is_connected(state: tauri::State<AppState>) -> Result<bool, String> {
    let handle = state.writer.lock().map_err(|e| e.to_string())?;
    Ok(handle.is_some())
}

/// 发送数据到串口
#[tauri::command]
fn send_data(data: String, state: tauri::State<AppState>) -> Result<(), String> {
    let mut guard = state.writer.lock().map_err(|e| e.to_string())?;
    let writer = guard.as_mut().ok_or("串口未连接")?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("发送失败: {}", e))?;
    writer.flush().map_err(|e| format!("flush 失败: {}", e))?;
    Ok(())
}

/// 定位 plugins/esp-at/ 下的文件
/// 生产构建后资源在 resource_dir 中直接可用，dev 模式需回退到 project root 相对路径
fn resolve_plugin_file(rel: &str, app: &AppHandle) -> Result<PathBuf, String> {
    const REL_PATH: &str = "plugins/esp-at";
    if let Ok(resource_dir) = app.path().resource_dir() {
        // 生产模式：resources 直接映射到 resource_dir/plugins/esp-at/
        let prod = resource_dir.join(REL_PATH).join(rel);
        if prod.exists() {
            return Ok(prod);
        }
        // dev 模式：resource_dir 通常是 src-tauri，向上到项目根
        if let Some(parent) = resource_dir.parent() {
            let dev = parent.join(REL_PATH).join(rel);
            if dev.exists() {
                return Ok(dev);
            }
        }
    }
    for base in &[
        PathBuf::from(REL_PATH),
        PathBuf::from("..").join(REL_PATH),
        PathBuf::from("../..").join(REL_PATH),
        PathBuf::from("../../..").join(REL_PATH),
    ] {
        let full = base.join(rel);
        if full.exists() {
            return Ok(full);
        }
    }
    Err(format!("找不到 plugins/esp-at/{}", rel))
}

/// 加载命令库 JSON
#[tauri::command]
fn load_commands(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = resolve_plugin_file("commands.json", &app)?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 {:?} 失败: {}", path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))
}

/// 加载解析规则 JSON
#[tauri::command]
fn load_parser(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = resolve_plugin_file("parser.json", &app)?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 {:?} 失败: {}", path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))
}

/// 保存日志到文件
#[tauri::command]
fn save_logs(content: String, path: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入 {:?} 失败: {}", path, e))
}

/// 脚本文件结构
#[derive(Debug, Deserialize, Serialize)]
pub struct Script {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub steps: Vec<ScriptStepRaw>,
}

/// 脚本摘要（列表用，不含步骤）
#[derive(Debug, Default, Serialize)]
pub struct ScriptSummary {
    pub name: String,
    pub description: String,
    pub path: String,
    #[serde(default)]
    pub is_builtin: bool,
}

/// 脚本执行结果
#[derive(Debug, Clone, Serialize)]
pub struct ScriptResult {
    pub name: String,
    pub total: usize,
    pub ok: usize,
    pub fail: usize,
    pub duration_ms: u64,
}

/// 脚本步骤（扁平结构，对应 YAML 的 - send / - wait / - delay）
#[derive(Debug, Deserialize, Serialize)]
pub struct ScriptStepRaw {
    #[serde(default)]
    pub send: Option<String>,
    #[serde(default)]
    pub wait: Option<String>,
    #[serde(default)]
    pub delay: Option<u64>,
    #[serde(default)]
    pub timeout: Option<u64>,
}

/// 列出所有脚本（内置 + 用户）
#[tauri::command]
fn list_scripts(app: AppHandle) -> Result<Vec<ScriptSummary>, String> {
    let scripts_dir = resolve_plugin_file("scripts", &app)?;
    if !scripts_dir.is_dir() {
        if let Some(parent) = scripts_dir.parent() {
            let candidate = parent.join("scripts");
            if candidate.is_dir() {
                return list_all_scripts(candidate);
            }
        }
        return Ok(Vec::new());
    }
    list_all_scripts(scripts_dir)
}

fn list_all_scripts(scripts_dir: PathBuf) -> Result<Vec<ScriptSummary>, String> {
    let mut results = Vec::new();
    if let Ok(builtins) = list_scripts_in_dir(scripts_dir.clone()) {
        results.extend(builtins.into_iter().map(|mut s| { s.is_builtin = true; s }));
    }
    let user_dir = scripts_dir.join("user");
    if user_dir.is_dir() {
        if let Ok(users) = list_scripts_in_dir(user_dir) {
            results.extend(users.into_iter().map(|mut s| { s.is_builtin = false; s }));
        }
    }
    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}

fn list_scripts_in_dir(dir: PathBuf) -> Result<Vec<ScriptSummary>, String> {
    let mut results = Vec::new();
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("读取脚本目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取脚本目录条目失败: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(true, |ext| ext != "yaml" && ext != "yml") {
            continue;
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取 {:?} 失败: {}", path, e))?;
        if let Ok(script) = serde_yaml::from_str::<Script>(&content) {
            results.push(ScriptSummary {
                name: script.name,
                description: script.description,
                path: path.to_string_lossy().to_string(),
                ..Default::default()
            });
        }
    }
    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}

/// 加载 YAML 脚本
#[tauri::command]
fn load_script(path: String) -> Result<Script, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 {:?} 失败: {}", path, e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("解析 YAML 失败: {}", e))
}

/// 运行脚本：依次执行每个步骤，发送数据 → 等待响应 → 延时
/// wait 通过共享 RX buffer 真正匹配串口返回数据，支持 timeout 超时
#[tauri::command]
fn run_script(path: String, app: AppHandle) -> Result<(), String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 {:?} 失败: {}", path, e))?;
    let script = serde_yaml::from_str::<Script>(&content)
        .map_err(|e| format!("解析 YAML 失败: {}", e))?;
    run_script_impl(script, app)
}

/// 带变量替换运行脚本 — 将脚本中的 {key} 替换为用户提供的值后再执行
#[tauri::command]
fn run_script_with_vars(path: String, vars: HashMap<String, String>, app: AppHandle) -> Result<(), String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 {:?} 失败: {}", path, e))?;
    let mut content = content;
    for (key, value) in &vars {
        let placeholder = format!("{{{}}}", key);
        content = content.replace(&placeholder, value);
    }
    let script = serde_yaml::from_str::<Script>(&content)
        .map_err(|e| format!("解析 YAML 失败: {}", e))?;
    run_script_impl(script, app)
}

fn run_script_impl(script: Script, app: AppHandle) -> Result<(), String> {
    // 检查连接状态
    let state = app.state::<AppState>();
    {
        let writer = state.writer.lock().map_err(|e| e.to_string())?;
        if writer.is_none() {
            return Err("串口未连接".into());
        }
    }

    // 重置取消标志
    state.script_cancel.store(false, Ordering::SeqCst);
    let script_cancel = state.script_cancel.clone();
    let rx_buffer = state.rx_buffer.clone();

    thread::spawn(move || {
        let start = std::time::Instant::now();
        let total = script.steps.len();
        let mut ok_count = 0usize;
        let mut fail_count = 0usize;
        let _ = app.emit("script://start", &script.name);
        for (i, step) in script.steps.iter().enumerate() {
            if script_cancel.load(Ordering::SeqCst) {
                let _ = app.emit("script://step", "已取消".to_string());
                break;
            }
            if let Some(cmd) = &step.send {
                let _ = app.emit("script://step", format!("[{}/{}] TX: {}", i + 1, total, cmd));
                if let Ok(mut rx) = rx_buffer.lock() { rx.clear(); }
                let state = app.state::<AppState>();
                {
                    if let Ok(mut guard) = state.writer.lock() {
                        if let Some(writer) = guard.as_mut() {
                            let _ = writer.write_all(format!("{}\r\n", cmd).as_bytes());
                            let _ = writer.flush();
                        }
                    };
                }
            }
            if let Some(ms) = step.delay {
                thread::sleep(Duration::from_millis(ms));
            }
            if let Some(pattern) = &step.wait {
                let timeout_ms = step.timeout.unwrap_or(2000);
                let _ = app.emit("script://step", format!("[{}/{}] 等待: {}", i + 1, total, pattern));
                let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
                let mut matched = false;
                while std::time::Instant::now() < deadline {
                    if script_cancel.load(Ordering::SeqCst) { break; }
                    let found = if let Ok(rx) = rx_buffer.lock() { rx.contains(pattern) } else { false };
                    if found { matched = true; break; }
                    thread::sleep(Duration::from_millis(30));
                }
                if matched {
                    let _ = app.emit("script://step", format!("[{}/{}] ✓ 匹配: {}", i + 1, total, pattern));
                    ok_count += 1;
                } else if !script_cancel.load(Ordering::SeqCst) {
                    let _ = app.emit("script://step", format!("[{}/{}] ✗ 超时: {}", i + 1, total, pattern));
                    fail_count += 1;
                }
            }
        }
        let result = ScriptResult {
            name: script.name.clone(),
            total,
            ok: ok_count,
            fail: fail_count,
            duration_ms: start.elapsed().as_millis() as u64,
        };
        let _ = app.emit("script://done", result);
    });

    Ok(())
}

/// 保存临时脚本到系统临时目录，返回文件路径
#[tauri::command]
fn save_temp_script(script: Script) -> Result<String, String> {
    let dir = std::env::temp_dir().join("esp-at-commander");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    let name = script.name.replace(' ', "_").replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "");
    let path = dir.join(format!("{}_{}.yaml", name, std::process::id()));
    let yaml = serde_yaml::to_string(&script).map_err(|e| format!("序列化脚本失败: {}", e))?;
    std::fs::write(&path, yaml).map_err(|e| format!("保存临时脚本失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// 保存脚本到指定文件路径
#[tauri::command]
fn save_script(script: Script, path: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let yaml = serde_yaml::to_string(&script).map_err(|e| format!("序列化脚本失败: {}", e))?;
    std::fs::write(&path, yaml).map_err(|e| format!("保存脚本失败: {}", e))
}

/// 获取用户脚本目录（用于自动保存）
#[tauri::command]
fn get_user_scripts_dir(app: AppHandle) -> Result<String, String> {
    let scripts_dir = resolve_plugin_file("scripts", &app)?;
    let user_dir = scripts_dir.join("user");
    std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户脚本目录失败: {}", e))?;
    user_dir.to_str().map(|s| s.to_string()).ok_or_else(|| "路径包含无效字符".to_string())
}

/// 删除脚本文件
#[tauri::command]
fn delete_script(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("文件不存在".to_string());
    }
    std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))
}

/// 取消正在执行的脚本
#[tauri::command]
fn cancel_script(state: tauri::State<AppState>) -> Result<(), String> {
    state.script_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            writer: Mutex::new(None),
            running: Arc::new(AtomicBool::new(false)),
            reader_thread: Mutex::new(None),
            script_cancel: Arc::new(AtomicBool::new(false)),
            rx_buffer: Arc::new(Mutex::new(String::new())),
            last_port: Mutex::new(None),
            last_baud: Mutex::new(None),
            last_data_bits: Mutex::new(None),
            last_stop_bits: Mutex::new(None),
            last_parity: Mutex::new(None),
        })
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect_port,
            disconnect_port,
            is_connected,
            send_data,
            load_commands,
            load_parser,
            save_logs,
            list_scripts,
            load_script,
            run_script,
            run_script_with_vars,
            save_temp_script,
            save_script,
            delete_script,
            open_url,
            get_user_scripts_dir,
            cancel_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
