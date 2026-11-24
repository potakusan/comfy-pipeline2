"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Pencil, Plus, Search } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerClose } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PickItem {
  id: string;
  name: string;
  category?: string | null;
  note?: string;
}

interface Base {
  label: string;
  items: PickItem[];
  categories?: { id: string; name: string }[];
  emptyText?: string;
  /** 渡すと各行に鉛筆ボタンが出る。押すと一覧を閉じて編集を開く */
  onEditItem?: (id: string) => void;
  /** 渡すと一覧の末尾に「新規追加」が出る */
  onAdd?: () => void;
}
interface Single extends Base {
  multiple?: false;
  value: string | null;
  onChange: (id: string | null) => void;
}
interface Multi extends Base {
  multiple: true;
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * 選択行 + ボトムシートの一覧。スマホでは <select> や横並びチップより、検索付きの縦リストのほうが
 * 親指で正確に選べる(数百件の LoRA / プリセットがあるため)。
 */
export function Picker(props: Single | Multi) {
  const { label, items, categories = [], emptyText = "候補がありません", onEditItem, onAdd } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const summary = selected.length
    ? selected.map((id) => items.find((i) => i.id === id)?.name ?? id).join("、")
    : "なし";

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = items.filter((i) => !q || i.name.toLowerCase().includes(q));
    const named = categories
      .map((c) => ({ title: c.name, items: hit.filter((i) => i.category === c.id) }))
      .filter((g) => g.items.length > 0);
    const rest = hit.filter((i) => !i.category || !categories.some((c) => c.id === i.category));
    return [...(rest.length ? [{ title: named.length ? "未分類" : "", items: rest }] : []), ...named];
  }, [items, categories, query]);

  // 開いたときに、選択済みの項目(複数なら先頭のもの)が見える位置まで、一覧を自動でスクロールする
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const box = listRef.current;
      const el = box?.querySelector<HTMLElement>('[data-selected="true"]');
      if (!box || !el) return;
      const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top - (box.clientHeight - el.offsetHeight) / 2;
      box.scrollTop += delta;
    }, 60);
    return () => clearTimeout(t);
  }, [open]);

  function toggle(id: string) {
    if (props.multiple) {
      props.onChange(props.value.includes(id) ? props.value.filter((v) => v !== id) : [...props.value, id]);
    } else {
      props.onChange(props.value === id ? null : id);
      setOpen(false);
    }
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DrawerTrigger asChild>
        <button type="button" className="row w-full text-left" style={{ background: "var(--color-paper-2)", border: 0, color: "inherit" }}>
          <span className="label" style={{ width: "5.5em", flexShrink: 0 }}>
            {label}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected.length ? "var(--color-ink)" : "var(--color-muted)" }}>
            {summary}
          </span>
          <ChevronRight size={18} aria-hidden style={{ color: "var(--color-muted)" }} />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{label}</DrawerTitle>
        </DrawerHeader>
        <div style={{ padding: "0 var(--space-md) var(--space-sm)", position: "relative" }}>
          <Search size={16} aria-hidden style={{ position: "absolute", left: 26, top: 14, color: "var(--color-muted)" }} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="検索" style={{ paddingLeft: 36 }} aria-label={`${label}を検索`} />
        </div>
        <div ref={listRef} style={{ overflowY: "auto", maxHeight: "55dvh", overscrollBehavior: "contain" }}>
          {items.length === 0 && <p className="label" style={{ padding: "var(--space-lg) var(--space-md)" }}>{emptyText}</p>}
          {items.length > 0 && groups.length === 0 && <p className="label" style={{ padding: "var(--space-lg) var(--space-md)" }}>「{query}」に一致するものがありません</p>}
          {groups.map((g) => (
            <section key={g.title || "all"}>
              {g.title && <h3 className="label" style={{ padding: "var(--space-sm) var(--space-md)", background: "var(--color-paper-3)" }}>{g.title}</h3>}
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.items.map((it) => {
                  const on = selected.includes(it.id);
                  return (
                    <li key={it.id} data-selected={on} style={{ display: "flex", alignItems: "stretch", background: on ? "var(--color-accent-soft)" : "var(--color-paper-2)", borderTop: "var(--rule-hair) solid var(--color-rule)" }}>
                      <button
                        type="button"
                        onClick={() => toggle(it.id)}
                        aria-pressed={on}
                        className="row text-left"
                        style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, color: "inherit" }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{it.name}</span>
                        {it.note && <span className="label">{it.note}</span>}
                        {on && <Check size={18} aria-hidden style={{ color: "var(--color-accent)" }} />}
                      </button>
                      {onEditItem && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${it.name}を編集`}
                          style={{ alignSelf: "center" }}
                          onClick={() => {
                            close();
                            onEditItem(it.id);
                          }}
                        >
                          <Pencil />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div style={{ padding: "var(--space-sm) var(--space-md) calc(var(--space-md) + var(--safe-bottom))", display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          {onAdd && (
            <Button
              variant="outline"
              onClick={() => {
                close();
                onAdd();
              }}
            >
              <Plus /> 新規追加
            </Button>
          )}
          {selected.length > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => (props.multiple ? props.onChange([]) : props.onChange(null))}>
              選択を外す
            </Button>
          )}
          <DrawerClose asChild>
            <Button className="flex-1">閉じる</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
