import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 全局错误显示：避免白屏无法诊断
function showErrorOverlay(err: unknown) {
  const existing = document.getElementById("err-overlay");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "err-overlay";
  div.style.cssText = "position:fixed;inset:0;background:#0f0f17;color:#ff6b6b;padding:32px;font-family:ui-monospace,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow:auto;z-index:99999;border:2px solid #ff6b6b";
  const msg = err instanceof Error
    ? `${err.name}: ${err.message}\n\n${err.stack ?? ""}`
    : String(err);
  div.textContent = `⚠ React 渲染错误\n\n${msg}`;
  document.body.appendChild(div);
}

window.addEventListener("error", (e) => showErrorOverlay(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showErrorOverlay(e.reason));

// 捕获 React 渲染错误
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string }) {
    const stack = info && info.componentStack ? info.componentStack : "";
    showErrorOverlay(`${error.message}\n\n${stack}`);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

const rootEl = document.getElementById('root')!;
// 启动时先清掉旧的错误覆盖层
const oldOverlay = document.getElementById("err-overlay");
if (oldOverlay) oldOverlay.remove();

try {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (err) {
  showErrorOverlay(err);
}
