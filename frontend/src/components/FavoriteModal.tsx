import { useEffect, useState } from "react";
import { useFavoritesStore } from "../stores/favorites";
import type { AtCommand } from "../types";

interface Props {
  command: AtCommand;
  values: Record<string, string>;
  onClose: () => void;
  onSaved?: () => void;
}

export function FavoriteModal({ command, values, onClose, onSaved }: Props) {
  const { groups, add, addGroup } = useFavoritesStore();
  const [label, setLabel] = useState(`${command.name} 预设`);
  const [selected, setSelected] = useState(groups[0] || "默认");
  const [newGroup, setNewGroup] = useState("");
  const [showNew, setShowNew] = useState(false);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = () => {
    const finalLabel = label.trim() || `${command.name} 预设`;
    let finalGroup = selected;
    // 若正在新建分组且填了名称，优先使用新分组
    if (showNew && newGroup.trim()) {
      finalGroup = newGroup.trim();
      addGroup(finalGroup);
    }
    add({
      cmdId: command.id,
      label: finalLabel,
      values: { ...values },
      group: finalGroup,
    });
    onSaved?.();
    onClose();
  };

  const handleCreateGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    addGroup(name);
    setSelected(name);
    setShowNew(false);
    setNewGroup("");
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">★ 收藏命令预设</span>
          <button className="modal-close" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* 命令信息 */}
          <div className="fm-cmd">
            <span className="fm-cmd-name">{command.name}</span>
            <span className="fm-cmd-summary">{command.summary}</span>
          </div>

          {/* 标签输入 */}
          <div className="fm-field">
            <label>预设名称</label>
            <input
              className="in"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如：公司 WiFi / 测试服务器"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>

          {/* 分组选择 */}
          <div className="fm-field">
            <label>收藏到分组</label>
            <div className="fm-groups">
              {groups.map((g) => (
                <button
                  key={g}
                  className={`fm-chip ${selected === g && !showNew ? "on" : ""}`}
                  onClick={() => {
                    setSelected(g);
                    setShowNew(false);
                  }}
                >
                  {g}
                </button>
              ))}
              <button
                className={`fm-chip fm-new ${showNew ? "on" : ""}`}
                onClick={() => setShowNew(true)}
              >
                + 新建分组
              </button>
            </div>
          </div>

          {/* 新建分组输入 */}
          {showNew && (
            <div className="fm-new-row">
              <input
                className="in"
                type="text"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="输入新分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroup();
                  if (e.key === "Escape") setShowNew(false);
                }}
              />
              <button className="btn btn-brand" onClick={handleCreateGroup}>
                添加
              </button>
              <button className="btn" onClick={() => setShowNew(false)}>
                取消
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-brand" onClick={handleSave}>
            保存收藏
          </button>
        </div>
      </div>
    </div>
  );
}
