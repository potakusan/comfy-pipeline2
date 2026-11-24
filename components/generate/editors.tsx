"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import { PRESET_LABEL, type LibraryResponse } from "@/lib/client/types";
import type { LoraEntry, Preset, PresetType } from "@/lib/comfy/comfy-types";
import type { BatchPreset } from "@/lib/comfy/batch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenSheet } from "@/components/shell/screen-sheet";
import { TagField } from "@/components/shell/tag-field";
import { Picker } from "./picker";
import { DanbooruImport } from "./lora-add";

const edit = <T,>(body: Record<string, unknown>) => api<T>("/api/library/edit", "POST", body);
const mono = { fontFamily: "var(--font-outlier)", fontSize: "var(--text-sm)" } as const;

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-xs)" }}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && <p className="label" style={{ fontSize: "var(--text-xs)" }}>{hint}</p>}
    </div>
  );
}

function ModeChips<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
      {options.map((o) => (
        <button key={o.id} type="button" className="chip" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- プリセット(身体・人数・ポーズ・シーン・その他) ---------------------------------------

export function PresetEditor({ type, id, categories, onClose, onSaved }: {
  type: PresetType;
  /** null = 新規 */
  id: string | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"all" | "random">("all");
  const [category, setCategory] = useState("");
  const [presetId] = useState(() => id ?? crypto.randomUUID());

  useEffect(() => {
    if (!id) return;
    edit<{ preset: Preset }>({ action: "get-preset", type, id })
      .then(({ preset }) => {
        setName(preset.name);
        setPrompt(preset.prompt);
        setMode(preset.promptMode === "random" ? "random" : "all");
        setCategory(preset.category ?? "");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "読み込めませんでした"))
      .finally(() => setLoading(false));
  }, [id, type]);

  async function save() {
    setSaving(true);
    try {
      await edit({ action: "save-preset", type, preset: { id: presetId, name, prompt, promptMode: mode, category: category || undefined } });
      toast.success("保存しました");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`「${name}」を削除します。よろしいですか？`)) return;
    try {
      await edit({ action: "delete-preset", type, id: presetId });
      toast.success("削除しました");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除できませんでした");
    }
  }

  return (
    <ScreenSheet
      title={`${PRESET_LABEL[type]}を${id ? "編集" : "追加"}`}
      onClose={onClose}
      footer={
        <>
          {id && (
            <Button variant="destructive" size="icon-lg" aria-label="削除" onClick={() => void remove()}>
              <Trash2 />
            </Button>
          )}
          <Button size="lg" className="flex-1" disabled={saving || loading || !name.trim()} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Field label="名前" htmlFor="p-name">
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="プロンプト" htmlFor="p-prompt" hint="# で始まる行はコメント。%%変数名%% で変数を使えます。">
            <TagField multiline id="p-prompt" value={prompt} onChange={setPrompt} rows={10} style={mono} />
          </Field>
          <Field label="使い方">
            <ModeChips
              label="使い方"
              value={mode}
              onChange={setMode}
              options={[
                { id: "all", label: "全文を使う" },
                { id: "random", label: "1行をランダムに選ぶ" },
              ]}
            />
          </Field>
          {categories.length > 0 && (
            <Field label="カテゴリ">
              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                <button type="button" className="chip" aria-pressed={category === ""} onClick={() => setCategory("")}>
                  未分類
                </button>
                {categories.map((c) => (
                  <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </>
      )}
    </ScreenSheet>
  );
}

// ---- 変数 %%name%% ---------------------------------------------------------------------

export function VariableEditor({ name: initialName, onClose, onSaved }: {
  /** null = 新規 */
  name: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [mode, setMode] = useState<"fixed" | "random" | "input">("input");
  const [value, setValue] = useState("");
  const [candidates, setCandidates] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!initialName);

  useEffect(() => {
    if (!initialName) return;
    // 一覧は軽量版なので、定義の全文は library から取り直す
    fetch("/api/library", { cache: "no-store" })
      .then((r) => r.json() as Promise<LibraryResponse>)
      .then((lib) => {
        const d = lib.variableDefs.find((x) => x.name === initialName);
        if (d) {
          setMode(d.mode);
          setValue(d.value ?? "");
          setCandidates((d.candidates ?? []).join("\n"));
        }
      })
      .finally(() => setLoading(false));
  }, [initialName]);

  async function save() {
    setSaving(true);
    try {
      await edit({
        action: "save-variable",
        def: { name: name.trim(), mode, value, candidates: candidates.split("\n").map((c) => c.trim()).filter(Boolean) },
      });
      toast.success("保存しました");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`変数「${name}」の定義を削除します。プロンプト中の %%${name}%% はそのまま残ります。`)) return;
    await edit({ action: "delete-variable", name }).catch(() => {});
    onSaved();
    onClose();
  }

  return (
    <ScreenSheet
      title={initialName ? `変数 %%${initialName}%%` : "変数を追加"}
      onClose={onClose}
      footer={
        <>
          {initialName && (
            <Button variant="destructive" size="icon-lg" aria-label="定義を削除" onClick={() => void remove()}>
              <Trash2 />
            </Button>
          )}
          <Button size="lg" className="flex-1" disabled={saving || loading || !name.trim()} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Field label="変数名(英数字と _)" htmlFor="v-name">
            <Input id="v-name" value={name} disabled={!!initialName} onChange={(e) => setName(e.target.value)} style={mono} />
          </Field>
          <Field label="解決のしかた" hint="固定: いつも同じ値 / ランダム: 候補から1枚ごとに抽選 / 入力: 生成画面で毎回入力">
            <ModeChips
              label="解決のしかた"
              value={mode}
              onChange={setMode}
              options={[
                { id: "fixed", label: "固定" },
                { id: "random", label: "ランダム" },
                { id: "input", label: "入力" },
              ]}
            />
          </Field>
          {mode !== "random" && (
            <Field label={mode === "fixed" ? "値" : "既定値(未入力のとき)"} htmlFor="v-value">
              <TagField id="v-value" value={value} onChange={setValue} />
            </Field>
          )}
          {mode !== "fixed" && (
            <Field label={mode === "random" ? "候補(1行に1つ)" : "入力の候補(1行に1つ・任意)"} htmlFor="v-cands">
              <TagField multiline id="v-cands" value={candidates} onChange={setCandidates} rows={8} style={mono} />
            </Field>
          )}
        </>
      )}
    </ScreenSheet>
  );
}

// ---- LoRA(強度・トリガーワード) ---------------------------------------------------------

export function LoraEditor({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved: () => void }) {
  const [lora, setLora] = useState<LoraEntry | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    edit<{ lora: LoraEntry }>({ action: "get-lora", name })
      .then((r) => setLora(r.lora))
      .catch((e) => toast.error(e instanceof Error ? e.message : "読み込めませんでした"));
  }, [name]);

  async function save() {
    if (!lora) return;
    setSaving(true);
    try {
      await edit({ action: "save-lora", lora });
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
      title="LoRAを編集"
      onClose={onClose}
      footer={
        <Button size="lg" className="flex-1" disabled={saving || !lora} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </Button>
      }
    >
      {!lora ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <p className="measured" style={{ overflowWrap: "anywhere" }}>{lora.name}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)" }}>
            <Field label="強度" htmlFor="l-str">
              <Input id="l-str" type="number" inputMode="decimal" step={0.05} value={lora.strength} onChange={(e) => setLora({ ...lora, strength: Number(e.target.value) })} />
            </Field>
            <Field label="CLIP強度" htmlFor="l-clip">
              <Input id="l-clip" type="number" inputMode="decimal" step={0.05} value={lora.clipStrength} onChange={(e) => setLora({ ...lora, clipStrength: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="トリガーワード" htmlFor="l-trig" hint="# で始まる行はコメント。">
            <TagField multiline id="l-trig" value={lora.triggerWords} onChange={(v) => setLora({ ...lora, triggerWords: v })} rows={9} style={mono} />
          </Field>
          <DanbooruImport value={lora.triggerWords} onChange={(v) => setLora({ ...lora, triggerWords: v })} />
        </>
      )}
    </ScreenSheet>
  );
}

// ---- 一括キューのプリセット ---------------------------------------------------------------

export function BatchPresetEditor({ setId, presetId, lib, onClose, onSaved, onEditPreset }: {
  setId: string;
  presetId: string;
  lib: LibraryResponse;
  onClose: () => void;
  onSaved: () => void;
  /** 人数・ポーズ・シーン・その他の鉛筆/追加。呼び出し側がその上に編集シートを重ねる */
  onEditPreset: (type: PresetType, id: string | null) => void;
}) {
  const [p, setP] = useState<BatchPreset | null>(null);
  const [variation, setVariation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    edit<{ preset: BatchPreset }>({ action: "get-batch-preset", setId, id: presetId })
      .then(({ preset }) => {
        setP(preset);
        setVariation((preset.variationTags ?? []).join("\n"));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "読み込めませんでした"));
  }, [setId, presetId]);

  async function save() {
    if (!p) return;
    setSaving(true);
    try {
      await edit({
        action: "save-batch-preset",
        setId,
        preset: { ...p, variationTags: variation.split("\n").map((t) => t.trim()).filter(Boolean) },
      });
      toast.success("保存しました");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<BatchPreset>) => p && setP({ ...p, ...patch });

  return (
    <ScreenSheet
      title="一括キューのプリセットを編集"
      onClose={onClose}
      footer={
        <Button size="lg" className="flex-1" disabled={saving || !p || !p.name.trim()} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </Button>
      }
    >
      {!p ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Field label="名前(出力ファイル名の接頭辞にもなります)" htmlFor="b-name">
            <Input id="b-name" value={p.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="枚数" htmlFor="b-count">
            <Input id="b-count" type="number" inputMode="numeric" min={1} value={p.batchCount} onChange={(e) => set({ batchCount: Number(e.target.value) })} style={{ ...mono, maxWidth: "8em" }} />
          </Field>
          <section className="seams" aria-label="組み合わせ">
            <Picker label="人数" items={lib.count} categories={lib.categories} value={p.countPresetId} onChange={(v) => set({ countPresetId: v })} onEditItem={(id) => onEditPreset("count", id)} onAdd={() => onEditPreset("count", null)} />
            <Picker label="ポーズ" items={lib.pose} categories={lib.categories} value={p.posePresetId} onChange={(v) => set({ posePresetId: v })} onEditItem={(id) => onEditPreset("pose", id)} onAdd={() => onEditPreset("pose", null)} />
            <Picker label="シーン" items={lib.scene} categories={lib.categories} value={p.scenePresetId ?? null} onChange={(v) => set({ scenePresetId: v })} onEditItem={(id) => onEditPreset("scene", id)} onAdd={() => onEditPreset("scene", null)} />
            <Picker label="その他" multiple items={lib.other} categories={lib.categories} value={p.otherPresetIds} onChange={(v) => set({ otherPresetIds: v })} onEditItem={(id) => onEditPreset("other", id)} onAdd={() => onEditPreset("other", null)} />
          </section>
          <Field label="追加プロンプト" htmlFor="b-add" hint="# で始まる行はコメント。%%変数%% も使えます。">
            <TagField multiline id="b-add" value={p.additionalPrompt} onChange={(v) => set({ additionalPrompt: v })} rows={5} style={mono} />
          </Field>
          <ModeChips
            label="追加プロンプトの使い方"
            value={p.additionalPromptMode}
            onChange={(v) => set({ additionalPromptMode: v })}
            options={[
              { id: "all", label: "全行を使う" },
              { id: "random", label: "1行をランダムに選ぶ" },
            ]}
          />
          <Field label="ネガティブプロンプト" htmlFor="b-neg">
            <TagField multiline id="b-neg" value={p.negativePrompt} onChange={(v) => set({ negativePrompt: v })} rows={4} style={mono} />
          </Field>
          <Field label="ランダム構図" hint="1枚ごとに1行を選んで末尾に足します。">
            <ModeChips
              label="ランダム構図"
              value={p.randomCompositionEnabled === false ? "off" : "on"}
              onChange={(v) => set({ randomCompositionEnabled: v === "on" })}
              options={[
                { id: "on", label: "使う" },
                { id: "off", label: "使わない" },
              ]}
            />
            <TagField multiline aria-label="構図タグ(1行に1つ)" value={variation} onChange={setVariation} rows={6} style={mono} />
          </Field>
        </>
      )}
    </ScreenSheet>
  );
}
