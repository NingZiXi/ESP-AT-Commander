import { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useSerialStore } from "../stores/serial";
import { useLogsStore } from "../stores/logs";
import { useCommandsStore } from "../stores/commands";
import { Folder, Play, Star, Trash } from "./Icons";
import type { AtCommand } from "../types";

interface ScriptStepRaw {
  send?: string;
  wait?: string;
  delay?: number;
  timeout?: number;
}

interface Script {
  name: string;
  description: string;
  steps: ScriptStepRaw[];
}

interface ScriptSummary {
  name: string;
  description: string;
  path: string;
  is_builtin: boolean;
}

/** 步骤模板：可复用的步骤组合 */
interface StepTemplate {
  id: string;
  name: string;
  steps: ScriptStepRaw[];
  createdAt: number;
}

/** 草稿快照：自动恢复用 */
interface ScriptDraft {
  script: Script;
  path: string;
  savedAt: number;
}

const TEMPLATE_STORAGE_KEY = "esp-at-commander:step-templates";
const DRAFT_STORAGE_KEY = "esp-at-commander:script-draft";
const DRAFT_DEBOUNCE_MS = 500;

type StepStatus = "pending" | "running" | "ok" | "fail";

function extractVars(steps: ScriptStepRaw[]): string[] {
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.send) continue;
    const matches = step.send.matchAll(/\{(\w[\w.-]*)\}/g);
    for (const m of matches) seen.add(m[1]);
  }
  return [...seen].sort();
}

const BLANK_SCRIPT: Script = {
  name: "未命名脚本",
  description: "",
  steps: [],
};

export function ScriptPanel() {
  const [script, setScript] = useState<Script | null>(null);
  const [scriptPath, setScriptPath] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [builtins, setBuiltins] = useState<ScriptSummary[]>([]);
  const [running, setRunning] = useState(false);
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>([]);
  const [activeStep, setActiveStep] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const [showVars, setShowVars] = useState(false);
  const [varKeys, setVarKeys] = useState<string[]>([]);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [scriptResult, setScriptResult] = useState<{ total: number; ok: number; fail: number; duration_ms: number } | null>(null);
  const [showCmdPicker, setShowCmdPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScriptSummary | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [clipboard, setClipboard] = useState<ScriptStepRaw[]>([]);
  const clipboardRef = useRef<ScriptStepRaw[]>([]);
  const dragStateRef = useRef({ startIdx: -1, currentIdx: -1 });
  // 拖拽幻影鼠标坐标
  const [phantomPos, setPhantomPos] = useState<{ x: number; y: number } | null>(null);
  // 步骤操作菜单(收起 5 个按钮为一个 ⋯ 按钮)
  const [menuOpenIdx, setMenuOpenIdx] = useState<number | null>(null);
  // 步骤模板
  const [templates, setTemplates] = useState<StepTemplate[]>(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StepTemplate[]) : [];
    } catch {
      return [];
    }
  });
  // 草稿恢复（启动时检测一次）
  const [pendingDraft, setPendingDraft] = useState<ScriptDraft | null>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ScriptDraft) : null;
    } catch {
      return null;
    }
  });
  // 批量选择
  const [selectedSteps, setSelectedSteps] = useState<Set<number>>(new Set());
  const [batchWait, setBatchWait] = useState("");
  const [batchTimeout, setBatchTimeout] = useState("");
  // 保存模板弹窗
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  // 选区锚点（用于 shift-click 区间选择）
  const selectionAnchorRef = useRef<number | null>(null);
  // 草稿自动保存定时器
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = useSerialStore((s) => s.status === "connected");
  const appendMany = useLogsStore((s) => s.appendMany);
  const categories = useCommandsStore((s) => s.categories);
  const loadCommands = useCommandsStore((s) => s.load);

  useEffect(() => {
    invoke<ScriptSummary[]>("list_scripts").then(setBuiltins).catch(() => {});
    if (categories.length === 0) loadCommands();
  }, []);

  // 草稿自动保存：script/dirty/path 变更时延迟 500ms 写入 localStorage
  useEffect(() => {
    if (!script || !dirty) {
      // 清空定时器但不动已保存的草稿（让用户主动选择恢复/丢弃）
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      return;
    }
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        const draft: ScriptDraft = { script, path: scriptPath, savedAt: Date.now() };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        /* 忽略存储失败 */
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [script, dirty, scriptPath]);

  // 模板变更时持久化
  useEffect(() => {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    } catch {
      /* 忽略 */
    }
  }, [templates]);

  useEffect(() => {
    const unlistens: Promise<() => void>[] = [
      listen<string>("script://start", () => { setRunning(true); }),
      listen<string>("script://step", (e) => {
        const msg = e.payload;
        const stepMatch = msg.match(/\[(\d+)\/\d+\]/);
        if (stepMatch) {
          const idx = parseInt(stepMatch[1], 10) - 1;
          setActiveStep(idx);
          if (msg.includes("✓")) {
            setStepStatuses((prev) => { const next = [...prev]; next[idx] = "ok"; return next; });
          } else if (msg.includes("✗")) {
            setStepStatuses((prev) => { const next = [...prev]; next[idx] = "fail"; return next; });
          } else if (msg.includes("TX:")) {
            setStepStatuses((prev) => { const next = [...prev]; next[idx] = "running"; return next; });
          }
        }
      }),
      listen("script://done", (e) => {
        setRunning(false);
        setActiveStep(-1);
        const data = e.payload as { total?: number; ok?: number; fail?: number; duration_ms?: number };
        if (typeof data === "object" && data.total != null) {
          const result = { total: data.total, ok: data.ok ?? 0, fail: data.fail ?? 0, duration_ms: data.duration_ms ?? 0 };
          setScriptResult(result);
          const durationSec = (result.duration_ms / 1000).toFixed(2);
          const toastType = result.fail === 0 ? "success" : "error";
          const message = `执行完成: ${result.ok} 成功 / ${result.fail} 失败 (${durationSec}s)`;
          setToast({ type: toastType, message });
          setTimeout(() => setToast(null), 3000);
        }
      }),
    ];
    return () => { unlistens.forEach((p) => p.then((un) => un())); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!script || running) return;
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if (ctrlKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        setScript((prev) => {
          if (!prev || prev.steps.length === 0) return prev;
          const steps = [...prev.steps];
          const last = steps.pop();
          if (last) steps.unshift(last);
          return { ...prev, steps };
        });
        setDirty(true);
      }
      if (ctrlKey && e.shiftKey && e.key === "z") {
        e.preventDefault();
        setScript((prev) => {
          if (!prev || prev.steps.length === 0) return prev;
          const steps = [...prev.steps];
          const first = steps.shift();
          if (first) steps.push(first);
          return { ...prev, steps };
        });
        setDirty(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [script, running]);

  const initScript = (s: Script, path?: string) => {
    setScript(s);
    setScriptPath(path ?? "");
    setDirty(false);
    setStepStatuses(s.steps.map(() => "pending"));
    setActiveStep(-1);
    setScriptResult(null);
    setError(null);
  };

  const handleNew = () => {
    initScript({ ...BLANK_SCRIPT, steps: [] });
  };

  const markDirty = () => setDirty(true);

  // -------- 步骤编辑 --------

  const handleAddCmd = (cmd: AtCommand) => {
    setShowCmdPicker(false);
    const sendCmd = cmd.template.replace(/\\"/g, '"').replace(/\r\n?|\n/g, "");
    const waitStr = cmd.responses?.[0] ?? "OK";
    const timeout = cmd.summary.includes("扫描") || cmd.summary.includes("连接") ? 15000 : 5000;
    setScript((prev) => prev && { ...prev, steps: [...prev.steps, { send: sendCmd, wait: waitStr, timeout }] });
    setDirty(true);
  };

  const handleAddDelay = () => {
    setScript((prev) => prev && { ...prev, steps: [...prev.steps, { delay: 500 }] });
    setDirty(true);
  };

  const handleRemoveStep = (i: number) => {
    setScript((prev) => prev && { ...prev, steps: prev.steps.filter((_, j) => j !== i) });
    setDirty(true);
  };

  const handleCopyStep = (step: ScriptStepRaw) => {
    const stepCopy = JSON.parse(JSON.stringify(step));
    clipboardRef.current = [stepCopy];
    setClipboard([stepCopy]);
  };

  const handlePaste = (index: number) => {
    if (clipboardRef.current.length === 0) return;
    const stepCopy = JSON.parse(JSON.stringify(clipboardRef.current[0]));
    setScript((prev) => {
      if (!prev) return prev;
      const steps = [...prev.steps];
      steps.splice(index, 0, stepCopy);
      return { ...prev, steps };
    });
    setDirty(true);
  };

  const handleMoveStep = (i: number, dir: -1 | 1) => {
    setScript((prev) => {
      if (!prev) return prev;
      const target = i + dir;
      if (target < 0 || target >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      [steps[i], steps[target]] = [steps[target], steps[i]];
      return { ...prev, steps };
    });
    setDirty(true);
  };

  const handlePointerDown = (e: React.MouseEvent, i: number) => {
    if (running) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "BUTTON" || target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    dragStateRef.current.startIdx = i;
    dragStateRef.current.currentIdx = i;
    setDragIdx(i);
    setIsDragging(true);
    setPhantomPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (dragIdx === null) return;
    setPhantomPos({ x: e.clientX, y: e.clientY });
    const stepsEl = document.querySelector(".sp-steps");
    if (!stepsEl) return;
    const rect = stepsEl.getBoundingClientRect();
    const stepEls = stepsEl.querySelectorAll<HTMLElement>(".sp-step");
    // 计算插入位置：根据鼠标 Y 在每个 step 中线之上还是之下
    let insertAt = stepEls.length;
    for (let i = 0; i < stepEls.length; i++) {
      const r = stepEls[i].getBoundingClientRect();
      const midY = r.top + r.height / 2;
      if (e.clientY < midY) {
        insertAt = i;
        break;
      }
    }
    // 拖到自己原位时按"在它之前"显示，避免视觉错位
    if (insertAt === dragIdx) insertAt = dragIdx;
    else if (insertAt > dragIdx) insertAt -= 0; // 保持显示位置
    setDragOverIdx(insertAt);
    dragStateRef.current.currentIdx = insertAt;
  }, [dragIdx]);

  const handleMouseUp = useCallback(() => {
    if (dragIdx === null) return;
    const { startIdx, currentIdx } = dragStateRef.current;
    if (startIdx !== -1 && currentIdx !== -1 && startIdx !== currentIdx && !running) {
      setScript((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        const [item] = steps.splice(startIdx, 1);
        // currentIdx 是在源数组里"插入前的位置"，但因为我们已经移除了 startIdx
        // 如果 currentIdx > startIdx，需要 -1
        const target = currentIdx > startIdx ? currentIdx - 1 : currentIdx;
        steps.splice(target, 0, item);
        return { ...prev, steps };
      });
      setDirty(true);
    }
    setDragIdx(null);
    setDragOverIdx(null);
    setIsDragging(false);
    setPhantomPos(null);
    dragStateRef.current = { startIdx: -1, currentIdx: -1 };
  }, [dragIdx, running]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleUpdateStep = (i: number, field: keyof ScriptStepRaw, value: string | number) => {
    setScript((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.map((s, j) => (j === i ? { ...s, [field]: value } : s));
      return { ...prev, steps };
    });
    setDirty(true);
  };

  const handleNameChange = (name: string) => { setScript((prev) => prev && { ...prev, name }); markDirty(); };
  const handleDescChange = (desc: string) => { setScript((prev) => prev && { ...prev, description: desc }); markDirty(); };

  // -------- 文件操作 --------

  const handleGoBack = () => {
    if (dirty) {
      setShowLeaveConfirm(true);
      return;
    }
    setScript(null);
    setScriptPath("");
    setError(null);
    setDirty(false);
  };

  const handleLeaveWithoutSave = () => {
    setShowLeaveConfirm(false);
    setScript(null);
    setScriptPath("");
    setError(null);
    setDirty(false);
  };

  const handleLeaveAndSave = async () => {
    setShowLeaveConfirm(false);
    if (!script) return;
    try {
      const userDir = await invoke<string>("get_user_scripts_dir");
      const fileName = `${script.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, "_")}.yaml`;
      const savePath = `${userDir}/${fileName}`;
      await invoke("save_script", { script, path: savePath });
      setScript(null);
      setScriptPath("");
      setError(null);
      setDirty(false);
    } catch (err) {
      setError(typeof err === "string" ? err : "保存失败");
    }
  };

  const handleDeleteClick = (s: ScriptSummary) => {
    setDeleteTarget(s);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_script", { path: deleteTarget.path });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      const updated = await invoke<ScriptSummary[]>("list_scripts");
      setBuiltins(updated);
    } catch (err) {
      setError(typeof err === "string" ? err : "删除失败");
      setShowDeleteConfirm(false);
    }
  };

  const handleSave = async () => {
    if (!script) return;
    setSaveStatus("saving");
    try {
      const userDir = await invoke<string>("get_user_scripts_dir");
      const fileName = `${script.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, "_")}.yaml`;
      const savePath = `${userDir}/${fileName}`;
      await invoke("save_script", { script, path: savePath });
      setScriptPath(savePath);
      setDirty(false);
      setSaveStatus("saved");
      // 保存成功时清理草稿
      try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* 忽略 */ }
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setError(typeof err === "string" ? err : "保存失败");
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  // -------- 步骤模板 --------

  /** 把当前选中步骤保存为模板 */
  const handleSaveAsTemplate = () => {
    if (!script || selectedSteps.size === 0) return;
    const name = templateName.trim() || `模板 ${templates.length + 1}`;
    const sortedIdxs = [...selectedSteps].sort((a, b) => a - b);
    const picked = sortedIdxs.map((i) => script.steps[i]).filter(Boolean);
    if (picked.length === 0) return;
    const tpl: StepTemplate = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      steps: picked.map((s) => JSON.parse(JSON.stringify(s))),
      createdAt: Date.now(),
    };
    setTemplates((prev) => [tpl, ...prev].slice(0, 50)); // 最多保留 50 个
    setShowSaveTemplate(false);
    setTemplateName("");
    setSelectedSteps(new Set());
  };

  /** 从模板插入步骤到末尾 */
  const handleInsertTemplate = (tpl: StepTemplate) => {
    setScript((prev) => {
      if (!prev) return prev;
      const inserted = tpl.steps.map((s) => JSON.parse(JSON.stringify(s)));
      return { ...prev, steps: [...prev.steps, ...inserted] };
    });
    setDirty(true);
  };

  /** 新建脚本并立即填入模板步骤 */
  const handleNewAndInsertTemplate = (tpl: StepTemplate) => {
    const steps = tpl.steps.map((s) => JSON.parse(JSON.stringify(s)));
    initScript({ name: tpl.name, description: `基于模板「${tpl.name}」`, steps });
    setDirty(true);
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  // -------- 草稿恢复 --------

  const handleRestoreDraft = () => {
    if (!pendingDraft) return;
    initScript(pendingDraft.script, pendingDraft.path || undefined);
    setDirty(true);
    setPendingDraft(null);
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* 忽略 */ }
  };

  const handleDiscardDraft = () => {
    setPendingDraft(null);
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* 忽略 */ }
  };

  // -------- 批量编辑 --------

  const toggleStepSelection = (i: number, e: React.MouseEvent) => {
    if (running) return;
    setSelectedSteps((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && selectionAnchorRef.current != null) {
        // shift-click 区间选择
        const [lo, hi] = [Math.min(selectionAnchorRef.current, i), Math.max(selectionAnchorRef.current, i)];
        for (let k = lo; k <= hi; k++) next.add(k);
      } else {
        if (next.has(i)) next.delete(i);
        else next.add(i);
        selectionAnchorRef.current = i;
      }
      return next;
    });
  };

  const handleBatchApply = () => {
    if (!script || selectedSteps.size === 0) return;
    setScript((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.map((s, i) => {
        if (!selectedSteps.has(i)) return s;
        const next: ScriptStepRaw = { ...s };
        if (batchWait.trim()) next.wait = batchWait.trim();
        if (batchTimeout.trim()) next.timeout = Number(batchTimeout);
        return next;
      });
      return { ...prev, steps };
    });
    setDirty(true);
  };

  const handleBatchDelete = () => {
    if (!script || selectedSteps.size === 0) return;
    setScript((prev) => {
      if (!prev) return prev;
      return { ...prev, steps: prev.steps.filter((_, i) => !selectedSteps.has(i)) };
    });
    setDirty(true);
    setSelectedSteps(new Set());
  };

  const handleBatchDuplicate = () => {
    if (!script || selectedSteps.size === 0) return;
    const sortedIdxs = [...selectedSteps].sort((a, b) => a - b);
    setScript((prev) => {
      if (!prev) return prev;
      const steps = [...prev.steps];
      // 从后往前插入以保持原顺序
      for (let k = sortedIdxs.length - 1; k >= 0; k--) {
        const i = sortedIdxs[k];
        const copy = JSON.parse(JSON.stringify(steps[i]));
        steps.splice(i + 1, 0, copy);
      }
      return { ...prev, steps };
    });
    setDirty(true);
    setSelectedSteps(new Set());
  };

  const handleClearSelection = () => setSelectedSteps(new Set());

  // 步骤数量变化时清理越界选择
  useEffect(() => {
    if (!script) return;
    setSelectedSteps((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      prev.forEach((i) => { if (i < script.steps.length) next.add(i); });
      return next.size === prev.size ? prev : next;
    });
  }, [script?.steps.length]);

  // 点击其他地方关闭步骤操作菜单
  useEffect(() => {
    if (menuOpenIdx === null) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".sp-step-menu") && !target.closest(".sp-step-menu-trigger")) {
        setMenuOpenIdx(null);
      }
    };
    // 下一帧再挂载,避免立即触发自身点击
    const timer = setTimeout(() => document.addEventListener("mousedown", close), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", close);
    };
  }, [menuOpenIdx]);

  const handleOpenFile = async () => {
    setError(null);
    try {
      const filePath = await open({
        multiple: false,
        filters: [{ name: "YAML Script", extensions: ["yaml", "yml"] }],
      });
      if (typeof filePath === "string") {
        const data = await invoke<Script>("load_script", { path: filePath });
        initScript(data, filePath);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : "加载失败");
    }
  };

  const loadScript = useCallback(async (path: string) => {
    setError(null);
    try {
      const data = await invoke<Script>("load_script", { path });
      initScript(data, path);
    } catch (err) {
      setError(typeof err === "string" ? err : "加载失败");
    }
  }, []);

  // -------- 执行 --------

  const handleExecute = async () => {
    if (!connected) {
      setError("串口未连接");
      return;
    }
    // 先保存到临时文件再执行
    if (!script) return;
    try {
      const path = scriptPath || await invoke<string>("save_temp_script", { script });
      if (!scriptPath) setScriptPath(path);
      setDirty(false);

      const keys = extractVars(script.steps);
      if (keys.length > 0) {
        setVarKeys(keys);
        const defaults: Record<string, string> = {};
        for (const k of keys) defaults[k] = varValues[k] ?? "";
        setVarValues(defaults);
        setShowVars(true);
        return;
      }
      doExecuteInternal(path);
    } catch (err) {
      setError(typeof err === "string" ? err : "运行失败");
    }
  };

  const doExecuteInternal = async (path: string, vars?: Record<string, string>) => {
    if (!connected) return;
    setError(null);
    setScriptResult(null);
    setStepStatuses(script?.steps.map(() => "pending") ?? []);
    setActiveStep(-1);
    appendMany([{ ts: Date.now(), dir: "tx", type: "event", data: `━━━ 开始执行: ${script?.name ?? ""} ━━━` }]);
    try {
      if (vars && Object.keys(vars).length > 0) {
        await invoke("run_script_with_vars", { path, vars });
      } else {
        await invoke("run_script", { path });
      }
    } catch (err) {
      setError(typeof err === "string" ? err : "运行失败");
      setRunning(false);
      setActiveStep(-1);
    }
  };

  const doExecute = async (vars?: Record<string, string>) => {
    setShowVars(false);
    doExecuteInternal(scriptPath, vars);
  };

  const handleCancel = async () => {
    try {
      await invoke("cancel_script");
      setRunning(false);
      setActiveStep(-1);
      appendMany([{ ts: Date.now(), dir: "tx", type: "event", data: "━━━ 脚本已取消 ━━━" }]);
    } catch { /* 忽略 */ }
  };

  const handleVarSubmit = () => {
    const filled: Record<string, string> = {};
    for (const k of varKeys) {
      if (varValues[k]?.trim()) filled[k] = varValues[k].trim();
    }
    doExecute(filled);
  };

  const handleOpenPicker = () => {
    setPickerSearch("");
    setShowCmdPicker(true);
  };

  const pickerQuery = pickerSearch.toLowerCase();
  const filteredCmds = categories.map((cat) => ({
    ...cat,
    commands: cat.commands.filter((c) =>
      !pickerQuery ||
      c.name.toLowerCase().includes(pickerQuery) ||
      c.summary.toLowerCase().includes(pickerQuery) ||
      c.template.toLowerCase().includes(pickerQuery)
    ),
  })).filter((cat) => cat.commands.length > 0);

  const builtinsList = builtins.filter((s) => s.is_builtin);
  const userScriptsList = builtins.filter((s) => !s.is_builtin);

  return (
    <div className="script-panel">
      <div className="sp-body ide-scroll">
        {!script && (
          <div className="sp-empty">
            <div className="sp-builtins">
              {builtinsList.length > 0 && (
                <>
                  <div className="section-label">内置脚本</div>
                  {builtinsList.map((s) => (
                    <div key={s.path} className="sp-builtin-item" onClick={() => loadScript(s.path)} title={s.description}>
                      <Play size={12} />
                      <div className="sp-builtin-info">
                        <span className="sp-builtin-name">{s.name}</span>
                        <span className="sp-builtin-desc">{s.description}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {userScriptsList.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: builtinsList.length > 0 ? "var(--spacer-12)" : 0 }}>我的脚本</div>
                  {userScriptsList.map((s) => (
                    <div key={s.path} className="sp-builtin-item" onClick={() => loadScript(s.path)} title={s.description}>
                      <Play size={12} />
                      <div className="sp-builtin-info">
                        <span className="sp-builtin-name">{s.name}</span>
                        <span className="sp-builtin-desc">{s.description}</span>
                      </div>
                      <button
                        className="btn btn-ghost btn-icon btn-sm sp-delete-btn"
                        onClick={(e) => { e.stopPropagation(); handleDeleteClick(s); }}
                        title="删除脚本"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {templates.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: "var(--spacer-12)" }}>步骤模板</div>
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="sp-template-item" onClick={() => handleNewAndInsertTemplate(tpl)} title={`包含 ${tpl.steps.length} 个步骤，点击新建脚本并插入`}>
                      <span className="sp-template-icon">⭐</span>
                      <div className="sp-template-info">
                        <span className="sp-template-name">{tpl.name}</span>
                        <span className="sp-template-meta">{tpl.steps.length} 步</span>
                      </div>
                      <button
                        className="btn btn-ghost btn-icon btn-sm sp-template-del"
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }}
                        title="删除模板"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {builtins.length === 0 && <div className="empty-state-hint">正在加载…</div>}
            </div>
            <div className="empty-state-hint sp-or-hint">— 或 —</div>
            <button className="btn btn-brand" onClick={handleNew}>
              <Play size={14} />
              新建脚本
            </button>
            <button className="btn btn-secondary" onClick={handleOpenFile}>
              <Folder size={14} />
              从文件加载
            </button>
          </div>
        )}
        {script && (
          <>
            {/* 草稿恢复提示：仅在刚加载且有未处理的草稿时显示 */}
            {pendingDraft && (
              <div className="sp-draft-banner">
                <div className="sp-draft-banner-text">
                  <div className="sp-draft-banner-title">检测到未保存的草稿</div>
                  <div className="sp-draft-banner-meta">
                    「{pendingDraft.script.name}」 · {pendingDraft.script.steps.length} 步 · {new Date(pendingDraft.savedAt).toLocaleString()}
                  </div>
                </div>
                <div className="sp-draft-banner-actions">
                  <button className="btn btn-ghost btn-sm" onClick={handleDiscardDraft}>丢弃</button>
                  <button className="btn btn-brand btn-sm" onClick={handleRestoreDraft}>恢复</button>
                </div>
              </div>
            )}

            {/* 可编辑标题区 */}
            <input
              className="sp-name-input"
              value={script.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="脚本名称"
            />
            <input
              className="sp-desc-input"
              value={script.description}
              onChange={(e) => handleDescChange(e.target.value)}
              placeholder="脚本描述（可选）"
            />
            <div className="sp-steps-header" style={{ display: "flex", alignItems: "center", gap: "var(--spacer-8)" }}>
              <div className="section-label" style={{ flex: 1, marginBottom: 0 }}>步骤 ({script.steps.length})</div>
              <button
                className="sp-save-template"
                onClick={() => { setTemplateName(""); setShowSaveTemplate(true); }}
                disabled={running || selectedSteps.size === 0}
                title={selectedSteps.size === 0 ? "先勾选要保存的步骤" : `将选中的 ${selectedSteps.size} 个步骤保存为模板`}
              >
                ⭐ 存为模板{selectedSteps.size > 0 ? ` (${selectedSteps.size})` : ""}
              </button>
            </div>
            {/* 批量操作栏 */}
            {selectedSteps.size > 0 && (
              <div className="sp-batch-bar">
                <span className="sp-batch-bar-count">已选 {selectedSteps.size}</span>
                <span className="sp-batch-bar-divider" />
                <div className="sp-batch-bar-fields">
                  <span className="sp-batch-bar-label">wait:</span>
                  <input
                    className="sp-batch-bar-input"
                    placeholder="留空不改"
                    value={batchWait}
                    onChange={(e) => setBatchWait(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleBatchApply(); }}
                  />
                </div>
                <div className="sp-batch-bar-fields">
                  <span className="sp-batch-bar-label">timeout(ms):</span>
                  <input
                    className="sp-batch-bar-input"
                    type="number"
                    min={0}
                    placeholder="留空不改"
                    value={batchTimeout}
                    onChange={(e) => setBatchTimeout(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleBatchApply(); }}
                  />
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleBatchApply} title="应用 wait/timeout 到选中步骤">
                  应用
                </button>
                <span className="sp-batch-bar-divider" />
                <button className="btn btn-secondary btn-sm" onClick={handleBatchDuplicate} title="在每个选中步骤后插入副本">
                  复制
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleBatchDelete} style={{ color: "var(--err)" }} title="删除选中步骤">
                  删除
                </button>
                <span className="sp-batch-bar-spacer" />
                <button className="btn btn-ghost btn-sm" onClick={handleClearSelection}>
                  取消选择
                </button>
              </div>
            )}
            <div>
              {script.steps.length === 0 && (
                <div className="empty-state-hint" style={{ padding: "var(--spacer-12) 0", textAlign: "center" }}>
                  点击下方按钮添加命令或延时 😎
                </div>
              )}
              <div className={`sp-steps ${isDragging ? "is-dragging-active" : ""}`}>
                {script.steps.map((step, i) => {
                  const st = stepStatuses[i] ?? "pending";
                  const isActive = i === activeStep && running;
                  const isDelay = step.delay != null;
                  const isSelected = selectedSteps.has(i);
                  // 在拖拽中：原位置显示半透明，目标插入位置前显示占位条
                  const showDropBefore = isDragging && dragOverIdx === i;
                  return (
                    <div key={i}>
                      {showDropBefore && <div className="sp-drop-indicator" />}
                      <div
                        className={`sp-step ${isActive ? "sp-step--active" : ""} sp-step--${st} ${isSelected ? "sp-step--selected" : ""} ${dragIdx === i ? "sp-step--is-dragging" : ""} ${dragIdx !== null && dragIdx !== i ? "sp-step--dimmed" : ""}`}
                        onMouseDown={(e) => handlePointerDown(e, i)}
                      >
                        <div className="sp-step-left">
                          <span
                            className={`sp-step-checkbox ${isSelected ? "is-checked" : ""}`}
                            onMouseDown={(e) => { e.stopPropagation(); }}
                            onClick={(e) => { e.stopPropagation(); toggleStepSelection(i, e); }}
                            title="勾选以进行批量操作（Shift+点击区间选择）"
                          />
                          {isActive
                            ? <span className="sp-check-icon running">▶</span>
                            : st === "ok"
                              ? <span className="sp-check-icon ok">✓</span>
                              : st === "fail"
                                ? <span className="sp-check-icon fail">✗</span>
                                : <span className="sp-check-icon pending">○</span>}
                          <span className="sp-idx">{i + 1}</span>
                        </div>
                        {isDelay ? (
                          <div className="sp-step-delay-row">
                            <span className="sp-step-type-badge">延时</span>
                            <input
                              className="sp-inline-input"
                              type="number"
                              min={0}
                              value={step.delay ?? ""}
                              onChange={(e) => handleUpdateStep(i, "delay", Number(e.target.value))}
                              disabled={running}
                            />
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>ms</span>
                          </div>
                        ) : (
                          <div className="sp-step-fields">
                            <div className="sp-step-cmd-field">
                              <span className="sp-step-type-badge">发送</span>
                              <input
                                className="sp-inline-input sp-inline-input--cmd"
                                value={step.send ?? ""}
                                onChange={(e) => handleUpdateStep(i, "send", e.target.value)}
                                disabled={running}
                              />
                            </div>
                            <div className="sp-step-wait-field">
                              <span className="sp-step-type-badge">等待</span>
                              <input
                                className="sp-inline-input sp-inline-input--small"
                                value={step.wait ?? ""}
                                onChange={(e) => handleUpdateStep(i, "wait", e.target.value)}
                                disabled={running}
                              />
                              <input
                                className="sp-inline-input sp-inline-input--mini"
                                type="number"
                                min={0}
                                value={step.timeout ?? ""}
                                onChange={(e) => handleUpdateStep(i, "timeout", Number(e.target.value))}
                                placeholder="ms"
                                disabled={running}
                              />
                            </div>
                          </div>
                        )}
                        <div className={`sp-step-actions ${menuOpenIdx === i ? "is-open" : ""}`}>
                          <button
                            className="btn btn-ghost btn-icon btn-sm sp-step-menu-trigger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenIdx(menuOpenIdx === i ? null : i);
                            }}
                            disabled={running}
                            title="更多操作"
                            aria-label="更多操作"
                          >
                            ⋯
                          </button>
                          {menuOpenIdx === i && (
                            <div className="sp-step-menu" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="sp-step-menu-item"
                                onClick={() => { handleMoveStep(i, -1); setMenuOpenIdx(null); }}
                                disabled={running || i === 0}
                              >
                                <span className="sp-step-menu-icon">↑</span>上移
                              </button>
                              <button
                                className="sp-step-menu-item"
                                onClick={() => { handleMoveStep(i, 1); setMenuOpenIdx(null); }}
                                disabled={running || i === script.steps.length - 1}
                              >
                                <span className="sp-step-menu-icon">↓</span>下移
                              </button>
                              <div className="sp-step-menu-divider" />
                              <button
                                className="sp-step-menu-item"
                                onClick={() => { handleCopyStep(step); setMenuOpenIdx(null); }}
                                disabled={running}
                              >
                                <span className="sp-step-menu-icon">📋</span>复制步骤
                              </button>
                              <button
                                className="sp-step-menu-item"
                                onClick={() => { handlePaste(i + 1); setMenuOpenIdx(null); }}
                                disabled={running || clipboard.length === 0}
                              >
                                <span className="sp-step-menu-icon">📄</span>粘贴到下方
                              </button>
                              <div className="sp-step-menu-divider" />
                              <button
                                className="sp-step-menu-item sp-step-menu-item--danger"
                                onClick={() => { handleRemoveStep(i); setMenuOpenIdx(null); }}
                                disabled={running}
                              >
                                <span className="sp-step-menu-icon">🗑</span>删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* 末尾占位：拖到最后一项之后时显示 */}
                {isDragging && dragOverIdx === script.steps.length && (
                  <div className="sp-drop-indicator" />
                )}
              </div>
            </div>

            {/* 拖拽幻影：跟随鼠标 */}
            {phantomPos && isDragging && dragIdx !== null && script.steps[dragIdx] && (
              <div
                className="sp-drag-phantom"
                style={{ left: phantomPos.x, top: phantomPos.y }}
              >
                <span className="sp-drag-phantom-icon">⠿</span>
                {script.steps[dragIdx].delay != null
                  ? `延时 ${script.steps[dragIdx].delay}ms`
                  : script.steps[dragIdx].send || "(空步骤)"}
              </div>
            )}
            {scriptResult && (
              <div className="sp-result">
                <div className="sp-result-row">
                  <span className="sp-result-icon">📊</span>
                  <span className="sp-result-title">执行摘要</span>
                </div>
                <div className="sp-result-stats">
                  <span className="sp-result-stat"><span className="sp-result-num">{scriptResult.total}</span> 总步骤</span>
                  <span className="sp-result-stat ok"><span className="sp-result-num">{scriptResult.ok}</span> ✓</span>
                  <span className="sp-result-stat fail"><span className="sp-result-num">{scriptResult.fail}</span> ✗</span>
                  <span className="sp-result-stat"><span className="sp-result-num">{(scriptResult.duration_ms / 1000).toFixed(2)}s</span></span>
                </div>
              </div>
            )}
            {error && <div className="err-msg">{error}</div>}
          </>
        )}
      </div>
      {script && (
        <div className="sp-actions">
          <div className="sp-actions-top">
            <button className="btn btn-ghost btn-sm" onClick={handleGoBack} disabled={running}>← 返回</button>
            <button className="btn btn-secondary btn-sm" onClick={handleOpenPicker} disabled={running}><Star size={11} />添加</button>
            <button className="btn btn-secondary btn-sm" onClick={handleAddDelay} disabled={running}>⏸ 延时</button>
            <button
              className={`btn btn-secondary btn-sm ${saveStatus === "saved" ? "btn-ok" : ""} ${saveStatus === "error" ? "btn-danger" : ""}`}
              onClick={handleSave}
              disabled={running || saveStatus === "saving"}
            >
              {saveStatus === "saving" ? "保存中..." : saveStatus === "saved" ? "✓ 已保存" : saveStatus === "error" ? "✗ 失败" : "💾 保存"}
            </button>
          </div>
          <div className="sp-actions-bottom">
            {running ? (
              <button className="btn btn-danger btn-sm" onClick={handleCancel}>取消</button>
            ) : (
              <button className="btn btn-brand btn-sm" onClick={handleExecute} disabled={!connected || script.steps.length === 0}>
                <Play size={11} />执行 ({script.steps.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 变量填写弹窗 */}
      {showVars && (
        <div className="modal-mask" onClick={() => setShowVars(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">填写变量</span>
              <button className="modal-close" onClick={() => setShowVars(false)}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              <div className={`var-inputs ${varKeys.length > 4 ? "var-inputs--grid" : ""}`}>
                {varKeys.map((k) => (
                  <div className="var-field" key={k}>
                    <label className="var-label">
                      <span className="var-brace">&#123;</span>
                      {k}
                      <span className="var-brace">&#125;</span>
                    </label>
                    <input
                      className="var-input"
                      placeholder="输入值…"
                      value={varValues[k] ?? ""}
                      onChange={(e) => setVarValues((prev) => ({ ...prev, [k]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleVarSubmit(); }}
                      autoFocus={k === varKeys[0]}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowVars(false)}>取消</button>
              <button className="btn btn-brand" onClick={handleVarSubmit}>执行</button>
            </div>
          </div>
        </div>
      )}

      {/* 未保存确认弹窗 */}
      {showLeaveConfirm && (
        <div className="modal-mask" onClick={() => setShowLeaveConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">未保存的更改</span>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                当前脚本「{script?.name}」有未保存的修改。是否在离开前保存？
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={handleLeaveWithoutSave}>不保存</button>
              <button className="btn btn-secondary" onClick={() => setShowLeaveConfirm(false)}>取消</button>
              <button className="btn btn-brand" onClick={handleLeaveAndSave}>保存并退出</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && deleteTarget && (
        <div className="modal-mask" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">删除脚本</span>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                确定要删除脚本「{deleteTarget.name}」吗？此操作无法撤销。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>取消</button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 保存为模板弹窗 */}
      {showSaveTemplate && (
        <div className="modal-mask" onClick={() => setShowSaveTemplate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">保存为模板</span>
              <button className="modal-close" onClick={() => setShowSaveTemplate(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="fm-field">
                <label>模板名称</label>
                <input
                  className="in"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={`模板 ${templates.length + 1}`}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveAsTemplate(); }}
                />
              </div>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: 0 }}>
                将把当前选中的 {selectedSteps.size} 个步骤保存为可复用的模板，下次可通过「步骤模板」一键新建脚本。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowSaveTemplate(false)}>取消</button>
              <button className="btn btn-brand" onClick={handleSaveAsTemplate}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 命令选择弹窗 */}
      {showCmdPicker && (
        <div className="modal-mask" onClick={() => setShowCmdPicker(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">从命令库添加步骤</span>
              <button className="modal-close" onClick={() => setShowCmdPicker(false)}>×</button>
            </div>
            <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "var(--spacer-12)", flex: 1, minHeight: 0 }}>
              <input
                className="param-input"
                style={{ marginBottom: "var(--spacer-12)" }}
                placeholder="搜索命令…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                autoFocus
              />
              {filteredCmds.map((cat) => (
                <div key={cat.id} style={{ marginBottom: "var(--spacer-8)" }}>
                  <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: "var(--spacer-4)" }}>{cat.name}</div>
                  {cat.commands.map((cmd) => (
                    <div key={cmd.id} className="sp-builtin-item" onClick={() => handleAddCmd(cmd)} title={cmd.description || cmd.summary}>
                      <Play size={12} />
                      <div className="sp-builtin-info">
                        <span className="sp-builtin-name" style={{ fontFamily: "var(--font-mono)" }}>{cmd.name}</span>
                        <span className="sp-builtin-desc">{cmd.summary}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toast && (
        <div className={`sp-toast sp-toast--${toast.type}`} onClick={() => setToast(null)}>
          <span className="sp-toast-icon">{toast.type === "success" ? "✓" : toast.type === "error" ? "✗" : "ℹ"}</span>
          <span className="sp-toast-message">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
