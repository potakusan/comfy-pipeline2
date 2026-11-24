"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Picker } from "@/components/generate/picker";
import { SIZE_PRESETS } from "@/lib/comfy/prompt";
import type { GenerationSettings } from "@/lib/comfy/comfy-types";

interface SettingsResponse {
  settings: GenerationSettings;
  options: { checkpoints: string[]; upscalers: string[]; samplers: string[]; schedulers: string[] };
  warning?: string;
}

const asItems = (names: string[]) => names.map((n) => ({ id: n, name: n }));

function NumberField({ id, label, value, step, onChange }: { id: string; label: string; value: number; step?: number; onChange: (n: number) => void }) {
  return (
    <div className="row">
      <label htmlFor={id} className="label" style={{ width: "8em", flexShrink: 0 }}>
        {label}
      </label>
      <Input id={id} type="number" inputMode="decimal" step={step ?? 1} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="measured" style={{ textAlign: "right" }} />
    </div>
  );
}

export function SettingsScreen() {
  const { data, error, loading, reload } = usePoll<SettingsResponse>("/api/settings", null);
  const [draft, setDraft] = useState<GenerationSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 取得した保存値を編集用の下書きに取り込む(初回のみ。編集中に上書きしない)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api("/api/settings", "PUT", draft);
      toast.success("保存しました。次の生成から反映されます");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (loading || (data && !draft)) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !data || !draft) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>設定を読み込めません</h2>
          <p className="label">{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }

  const set = (patch: Partial<GenerationSettings>) => setDraft({ ...draft, ...patch });
  const { options } = data;

  return (
    <div className="page">
      {data.warning && (
        <div className="panel panel-body" role="status" style={{ background: "var(--color-accent-soft)" }}>
          <p className="label">モデルの一覧を取得できませんでした(ComfyUI 未接続)。現在の値は保存済みのものです。</p>
        </div>
      )}
      {options.checkpoints.length > 0 && !options.checkpoints.includes(draft.checkpoint) && (
        <div className="panel panel-body" role="alert" style={{ background: "var(--color-bad-soft)" }}>
          <p>選択中のチェックポイント「{draft.checkpoint}」は ComfyUI にありません。このままでは生成できません。下で選び直して保存してください。</p>
        </div>
      )}
      <section className="seams" aria-label="モデル">
        <Picker label="チェックポイント" items={asItems(options.checkpoints.length ? options.checkpoints : [draft.checkpoint])} value={draft.checkpoint} onChange={(v) => v && set({ checkpoint: v })} />
        <Picker label="アップスケーラー" items={asItems(options.upscalers.length ? options.upscalers : [draft.upscaleModel])} value={draft.upscaleModel} onChange={(v) => v && set({ upscaleModel: v })} />
      </section>
      <section className="panel panel-body" aria-label="既定サイズ">
        <span className="label" id="size-label">既定の生成サイズ</span>
        <div role="group" aria-labelledby="size-label" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
          {SIZE_PRESETS.map((s) => (
            <button key={s.label} type="button" className="chip" aria-pressed={draft.width === s.width && draft.height === s.height} onClick={() => set({ width: s.width, height: s.height })}>
              {s.label} <span className="measured" style={{ marginLeft: 6 }}>{s.width}×{s.height}</span>
            </button>
          ))}
        </div>
        <p className="label" style={{ fontSize: "var(--text-xs)" }}>生成タブはこのサイズで開きます。生成タブで変えると、その回だけ上書きできます。</p>
      </section>
      <section className="seams" aria-label="サンプリング">
        <Picker label="サンプラー" items={asItems(options.samplers.length ? options.samplers : [draft.sampler])} value={draft.sampler} onChange={(v) => v && set({ sampler: v })} />
        <Picker label="スケジューラー" items={asItems(options.schedulers.length ? options.schedulers : [draft.scheduler])} value={draft.scheduler} onChange={(v) => v && set({ scheduler: v })} />
        <NumberField id="steps" label="ステップ数" value={draft.steps} onChange={(n) => set({ steps: n })} />
        <NumberField id="cfg" label="CFG" step={0.5} value={draft.cfg} onChange={(n) => set({ cfg: n })} />
        <NumberField id="upsteps" label="アップスケール後の追加ステップ" value={draft.upscaleSteps} onChange={(n) => set({ upscaleSteps: n })} />
      </section>
      <p className="label">プリセットとLoRAは comfy-pipeline 側のデータを読み取り専用で共有しています。</p>
      <Button size="lg" disabled={saving} onClick={() => void save()}>
        {saving ? "保存中…" : "保存"}
      </Button>
    </div>
  );
}
