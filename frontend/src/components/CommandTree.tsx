import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandsStore } from "../stores/commands";
import { useFavoritesStore, type FavoriteItem } from "../stores/favorites";
import { getCategoryIcon, ChevronRight, Expand, FileText, Search, Star } from "./Icons";
import type { AtCommand } from "../types";

interface Props {
  selected: string;
  onSelect: (cmd: AtCommand) => void;
  /** 加载收藏预设时回调，参数为命令 + 预设值 */
  onLoadFavorite?: (cmd: AtCommand, values: Record<string, string>) => void;
}

export function CommandTree({ selected, onSelect, onLoadFavorite }: Props) {
  const { categories, loading, error, load } = useCommandsStore();
  const {
    items: favorites,
    remove: removeFavorite,
    groups,
    removeGroup,
  } = useFavoritesStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [query, setQuery] = useState("");
  const [favCollapsed, setFavCollapsed] = useState(false);
  const [showDesc, setShowDesc] = useState(true);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<string | null>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    load();
  }, [load]);

  // 首次加载时默认展开前两个分类
  useEffect(() => {
    if (categories.length > 0 && !initedRef.current) {
      initedRef.current = true;
      setExpanded(new Set(categories.slice(0, 2).map((c) => c.id)));
    }
  }, [categories]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const findCmd = useCallback((cmdId: string): AtCommand | undefined => {
    for (const cat of categories) {
      const found = cat.commands.find((c) => c.id === cmdId);
      if (found) return found;
    }
    return undefined;
  }, [categories]);

  const handleClickFavorite = (fav: FavoriteItem) => {
    const cmd = findCmd(fav.cmdId);
    if (cmd && onLoadFavorite) {
      onLoadFavorite(cmd, fav.values);
    }
  };

  const handleDeleteFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeFavorite(id);
  };

  const toggleGroup = (name: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsedGroups(next);
  };

  const allExpanded = categories.length > 0 && expanded.size === categories.length;

  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(categories.map((c) => c.id)));
    }
  };

  const hasQuery = query.trim().length > 0;
  const q = query.toLowerCase();

  return (
    <aside className="command-tree">
      {/* 搜索 + 工具栏 */}
      <div className="tree-header">
        <div className="tree-search">
          <Search size={14} className="search-icon" />
          <input
            placeholder="搜索命令..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tree-toolbar">
          <button
            className="btn btn-ghost btn-sm"
            onClick={toggleAll}
            title={allExpanded ? "全部收起" : "全部展开"}
            disabled={hasQuery || categories.length === 0}
          >
            <Expand size={12} />
            {allExpanded ? "收起" : "展开"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setFavCollapsed((v) => !v)}
            title={favCollapsed ? "展开收藏区" : "折叠收藏区"}
          >
            <Star size={12} />
            收藏
          </button>
          <button
            className={`btn btn-ghost btn-sm ${showDesc ? "active" : ""}`}
            onClick={() => setShowDesc((v) => !v)}
            title={showDesc ? "隐藏命令简介" : "显示命令简介"}
          >
            <FileText size={12} />
            简介
          </button>
        </div>
      </div>

      {/* 命令树（可滚动） */}
      <div className="tree-body ide-scroll">
        {loading && <div className="term-empty">加载中…</div>}
        {error && (
          <div className="term-empty" style={{ color: "var(--err)" }}>
            {error}
          </div>
        )}
        {!loading && !error && categories.length === 0 && (
          <div className="term-empty">无可用命令</div>
        )}
        {categories.map((cat) => {
          const isOpen = hasQuery || expanded.has(cat.id);
          const cmds = cat.commands.filter((c) =>
            hasQuery
              ? c.name.toLowerCase().includes(q) ||
                c.summary.toLowerCase().includes(q) ||
                (c.description?.toLowerCase().includes(q) ?? false)
              : true,
          );
          if (hasQuery && cmds.length === 0) return null;
          return (
            <div key={cat.id}>
              <div className="cat-header" onClick={() => toggle(cat.id)}>
                <ChevronRight
                  size={14}
                  className={`cat-arrow ${isOpen ? "" : "collapsed"}`}
                />
                <span className="cat-icon">{getCategoryIcon(cat.id)}</span>
                <span className="cat-title">{cat.name}</span>
                <span className="cat-count">{cmds.length}</span>
              </div>
              {isOpen &&
                cmds.map((cmd) => (
                  <div
                    key={cmd.id}
                    className={`cmd-item ${selected === cmd.id ? "cmd-item--active" : ""}`}
                    onClick={() => onSelect(cmd)}
                    title={cmd.description || cmd.summary}
                  >
                    <span className="cmd-name">{cmd.name}</span>
                    <span className={`cmd-desc ${showDesc ? "" : "cmd-desc--hidden"}`}>{cmd.summary}</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      {/* 收藏区 */}
      <div className="fav-section" style={{ display: favCollapsed ? "none" : "block" }}>
        <div className="fav-header">
          <Star size={12} className="fav-header-icon" />
          <span className="fav-header-text">收藏 ({favorites.length})</span>
        </div>
        {favorites.length === 0 && (
          <div className="fav-empty">点击右栏 ★ 收藏命令预设</div>
        )}
        {groups.map((g) => {
          const items = favorites.filter((f) => f.group === g);
          if (items.length === 0) return null;
          const isOpen = !collapsedGroups.has(g);
          const isDefault = g === "默认";
          return (
            <div key={g}>
              <div
                className="fav-group-head"
                onClick={() => toggleGroup(g)}
                title={isOpen ? "折叠" : "展开"}
              >
                <ChevronRight
                  size={12}
                  className={`cat-arrow ${isOpen ? "" : "collapsed"}`}
                />
                <span>{g}</span>
                <span className="cat-count" style={{ marginLeft: "auto" }}>
                  {items.length}
                </span>
                {!isDefault && (
                  <button
                    className="fav-group-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteGroup(g);
                    }}
                    title="删除分组"
                  >
                    ×
                  </button>
                )}
              </div>
              {isOpen &&
                items.map((f) => (
                  <div
                    key={f.id}
                    className="fav-item"
                    onClick={() => handleClickFavorite(f)}
                    title={`${f.label}（点击加载预设）`}
                  >
                    <span className="fav-item-label">{f.label}</span>
                    <span
                      className="fav-item-del"
                      onClick={(e) => handleDeleteFavorite(e, f.id)}
                      title="删除收藏"
                    >
                      ×
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      {/* 删除分组确认弹窗 */}
      {pendingDeleteGroup && (() => {
        const items = favorites.filter((f) => f.group === pendingDeleteGroup);
        return (
          <div className="modal-mask" onClick={() => setPendingDeleteGroup(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">删除分组</span>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                  确定要删除分组「{pendingDeleteGroup}」吗?
                </p>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
                  组内 <b style={{ color: "var(--text)" }}>{items.length}</b> 个收藏项将归入「默认」组。
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setPendingDeleteGroup(null)}>取消</button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    removeGroup(pendingDeleteGroup);
                    setPendingDeleteGroup(null);
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </aside>
  );
}
