import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 自定义窗口控制按钮（最小化/最大化/关闭）
 * 仅在 Tauri 环境下显示
 */
export function WindowControls() {
  const win = getCurrentWindow();

  const handleMinimize = () => win.minimize();
  const handleToggleMax = () => win.toggleMaximize();
  const handleClose = () => win.close();

  // 阻止事件冒泡到父级 data-tauri-drag-region，避免拖拽拦截点击
  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div className="win-controls" onMouseDown={stop}>
      <button className="win-btn" onClick={handleMinimize} onMouseDown={stop} title="最小化">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5 H10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button className="win-btn" onClick={handleToggleMax} onMouseDown={stop} title="最大化/还原">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button className="win-btn close" onClick={handleClose} onMouseDown={stop} title="关闭">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
