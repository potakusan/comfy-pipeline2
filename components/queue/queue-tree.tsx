"use client";

import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface QueueItem {
  id: string;
  label: string;
  count: number;
  /** LoRA 名("no-lora" は LoRA なし) */
  lora: string;
  /** 一括キューのセット名(分からなければ null) */
  set: string | null;
}

/** ラベルは「セット / LoRA / プリセット」なので、一覧ではプリセット名だけを出す */
const presetOf = (label: string) => label.split(" / ").pop() || label;
const loraTitle = (lora: string) => (lora === "no-lora" || !lora ? "LoRAなし" : lora);

/** 順序は最初に出てきた順のまま、key でまとめる */
function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return [...m];
}

const sum = (items: QueueItem[]) => items.reduce((n, i) => n + i.count, 0);

/**
 * キュー(保留・待機中)を「LoRA → セット → プリセット」の順に畳んで見せる。
 * 大量にたまっても縦に伸びないよう、LoRA もセットも最初は閉じていて、開いた中だけ内側でスクロールする。
 */
export function QueueTree({ items, onRemove, onRemoveMany, removeWord }: { items: QueueItem[]; onRemove: (item: QueueItem) => void; onRemoveMany: (items: QueueItem[], name: string) => void; removeWord: string }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-xs)" }}>
      {groupBy(items, (i) => i.lora).map(([lora, inLora]) => {
        const sets = groupBy(inLora, (i) => i.set ?? "その他");
        return (
          <details key={lora} className="accordion">
            <summary style={{ gap: "var(--space-xs)" }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{loraTitle(lora)}</span>
              <span className="measured" style={{ color: "var(--color-muted)" }}>
                {sets.length > 1 ? `${sets.length}セット ／ ` : ""}
                {sum(inLora)}枚
              </span>
            </summary>
            <div style={{ display: "grid", gap: "var(--space-xs)", padding: "var(--space-xs)", maxHeight: "60dvh", overflowY: "auto", overscrollBehavior: "contain" }}>
              {sets.map(([set, inSet]) => (
                <details key={set} className="accordion">
                  <summary style={{ gap: "var(--space-xs)" }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{set}</span>
                    <span className="measured" style={{ color: "var(--color-muted)" }}>
                      {inSet.length}件 ／ {sum(inSet)}枚
                    </span>
                  </summary>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {inSet.map((h) => (
                      <li key={h.id} className="row" style={{ padding: 0, minHeight: 44 }} title={h.label}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "var(--space-sm)" }}>{presetOf(h.label)}</span>
                        <span className="measured">×{h.count}</span>
                        <Button variant="ghost" size="icon" aria-label={`${h.label}を${removeWord}`} onClick={() => onRemove(h)}>
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div style={{ padding: "var(--space-xs) var(--space-sm)" }}>
                    <Button variant="outline" size="sm" onClick={() => onRemoveMany(inSet, `${loraTitle(lora)} / ${set}`)}>
                      <Trash2 /> このセットを{removeWord}
                    </Button>
                  </div>
                </details>
              ))}
              <div>
                <Button variant="outline" size="sm" onClick={() => onRemoveMany(inLora, loraTitle(lora))}>
                  <Trash2 /> このLoRAをまとめて{removeWord}
                </Button>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
