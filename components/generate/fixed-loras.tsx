"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import type { LoraEntry } from "@/lib/comfy/comfy-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenSheet } from "@/components/shell/screen-sheet";
import { LoraEditor } from "./editors";
import { LoraAddSheet } from "./lora-add";
import { TagField } from "@/components/shell/tag-field";

/**
 * 固定LoRA(全ての生成に、必ず同じ強度で適用される LoRA)の一覧と編集。
 * 画風 LoRA など、セットやプリセットを選んでも常に付けたいものをここで管理する。
 */
export function FixedLorasSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<LoraEntry[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await api<{ loras: LoraEntry[] }>("/api/library/edit", "POST", { action: "list-fixed" })).loras);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "読み込めませんでした");
      setList([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const changed = () => {
    void load();
    onChanged();
  };

  async function remove(name: string) {
    if (armed !== name) return setArmed(name);
    setArmed(null);
    try {
      await api("/api/library/edit", "POST", { action: "delete-fixed-lora", name });
      toast.success("固定LoRAから外しました(LoRA のファイルは消えません)");
      changed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "外せませんでした");
    }
  }

  return (
    <ScreenSheet
      title="固定LoRA"
      onClose={onClose}
      footer={
        <Button size="lg" className="flex-1" onClick={() => setAdding(true)}>
          <Plus /> 固定LoRAを追加
        </Button>
      }
    >
      <p className="label" style={{ fontSize: "var(--text-xs)" }}>
        全ての生成に、必ず適用される LoRA です(画風など)。強度やトリガーワードは、ここで変えられます。
      </p>
      {list === null ? (
        <Skeleton className="h-24 w-full" />
      ) : list.length === 0 ? (
        <p className="label">固定LoRAはありません。</p>
      ) : (
        <ul className="seams" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {list.map((l) => (
            <li key={l.name} className="row" style={{ minHeight: 64 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflowWrap: "anywhere" }}>{l.name}</span>
                <span className="measured" style={{ color: "var(--color-muted)" }}>
                  強度 {l.strength} ／ CLIP {l.clipStrength}
                  {l.triggerWords.trim() ? " ／ トリガーワードあり" : ""}
                </span>
              </span>
              <Button variant="ghost" size="icon" aria-label={`${l.name}を編集`} onClick={() => setEditing(l.name)}>
                <Pencil />
              </Button>
              <Button variant={armed === l.name ? "destructive" : "ghost"} size={armed === l.name ? "default" : "icon"} aria-label={`${l.name}を固定から外す`} onClick={() => void remove(l.name)}>
                <Trash2 /> {armed === l.name ? "もう一度で外す" : null}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <LoraEditor key={editing} name={editing} fixed onClose={() => setEditing(null)} onSaved={changed} />}
      {adding && <LoraAddSheet fixed onClose={() => setAdding(false)} onAdded={changed} />}
    </ScreenSheet>
  );
}

/** 固定ポジティブ(全ての生成の先頭に付くタグ。品質タグなど)/ 固定ネガティブ(全ての生成のネガティブに付くタグ)の編集 */
export function FixedTagsSheet({ kind = "positive", onClose, onSaved }: { kind?: "positive" | "negative"; onClose: () => void; onSaved: () => void }) {
  const neg = kind === "negative";
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ text: string }>("/api/library/edit", "POST", { action: neg ? "get-negative" : "get-fixed-tags" })
      .then((r) => setText(r.text))
      .catch((e) => toast.error(e instanceof Error ? e.message : "読み込めませんでした"));
  }, [neg]);

  async function save() {
    setSaving(true);
    try {
      await api("/api/library/edit", "POST", { action: neg ? "save-negative" : "save-fixed-tags", text });
      toast.success("保存しました");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenSheet
      title={neg ? "固定ネガティブプロンプト" : "固定ポジティブプロンプト"}
      onClose={onClose}
      footer={
        <Button size="lg" className="flex-1" disabled={saving || text === null} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </Button>
      }
    >
      <p className="label" style={{ fontSize: "var(--text-xs)" }}>
        {neg ? "全ての生成のネガティブに付くタグです。プリセット固有のネガティブと同じタグは、1回だけ使われます。" : "全ての生成の先頭に付くタグです(品質タグなど)。"}
        # で始まる行はコメントになります。
      </p>
      {text === null ? <Skeleton className="h-40 w-full" /> : <TagField multiline id="fixed-tags" value={text} onChange={setText} rows={10} style={{ fontFamily: "var(--font-outlier)", fontSize: "var(--text-sm)" }} />}
    </ScreenSheet>
  );
}
