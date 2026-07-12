import { create } from "zustand";

/** 收藏项：命令 + 参数预设 */
export interface FavoriteItem {
  id: string; // 唯一 ID（命令 id + 时间戳）
  cmdId: string; // 关联的命令 id
  label: string; // 用户自定义标签
  values: Record<string, string>; // 参数预设
  group: string; // 所属分组名
  createdAt: number;
}

interface FavoritesState {
  items: FavoriteItem[];
  groups: string[]; // 分组列表
  add: (item: Omit<FavoriteItem, "id" | "createdAt">) => void;
  remove: (id: string) => void;
  rename: (id: string, label: string) => void;
  addGroup: (name: string) => void;
  removeGroup: (name: string) => void;
}

const STORAGE_KEY = "esp-at-commander:favorites";
const DEFAULT_GROUP = "默认";

interface StorageShape {
  items?: FavoriteItem[];
  groups?: string[];
}

function load(): { items: FavoriteItem[]; groups: string[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], groups: [DEFAULT_GROUP] };
    const parsed = JSON.parse(raw) as StorageShape;
    // 兼容旧格式（纯数组）
    if (Array.isArray(parsed)) {
      const items = parsed as unknown as FavoriteItem[];
      return {
        items: items.map((f) => ({ ...f, group: f.group || DEFAULT_GROUP })),
        groups: [DEFAULT_GROUP],
      };
    }
    const items = (parsed.items ?? []).map((f) => ({
      ...f,
      group: f.group || DEFAULT_GROUP,
    }));
    const groups = parsed.groups?.length ? parsed.groups : [DEFAULT_GROUP];
    return { items, groups };
  } catch {
    return { items: [], groups: [DEFAULT_GROUP] };
  }
}

function save(items: FavoriteItem[], groups: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, groups }));
  } catch {
    /* 忽略写入失败 */
  }
}

const initial = load();

export const useFavoritesStore = create<FavoritesState>((set) => ({
  items: initial.items,
  groups: initial.groups,
  add: (item) =>
    set((s) => {
      const items = [
        ...s.items,
        {
          ...item,
          id: `${item.cmdId}-${Date.now()}`,
          createdAt: Date.now(),
        },
      ];
      save(items, s.groups);
      return { items };
    }),
  remove: (id) =>
    set((s) => {
      const items = s.items.filter((f) => f.id !== id);
      save(items, s.groups);
      return { items };
    }),
  rename: (id, label) =>
    set((s) => {
      const items = s.items.map((f) =>
        f.id === id ? { ...f, label } : f,
      );
      save(items, s.groups);
      return { items };
    }),
  addGroup: (name) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed || s.groups.includes(trimmed)) return s;
      const groups = [...s.groups, trimmed];
      save(s.items, groups);
      return { groups };
    }),
  removeGroup: (name) =>
    set((s) => {
      // 删除分组时，组内收藏项归入默认组
      const groups = s.groups.filter((g) => g !== name);
      const items = s.items.map((f) =>
        f.group === name ? { ...f, group: DEFAULT_GROUP } : f,
      );
      const finalGroups = groups.length ? groups : [DEFAULT_GROUP];
      save(items, finalGroups);
      return { groups: finalGroups, items };
    }),
}));
