"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, FlaskConical, Layers, Pencil, Plus, Save, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { PresetType } from "@/lib/comfy/comfy-types";
import type { PlanRequest } from "@/lib/server/plan";
import type { LibraryResponse, VariableInfo } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TagField } from "@/components/shell/tag-field";
import { Picker, type PickItem } from "./picker";
import { BatchPresetEditor, LoraEditor, PresetEditor, VariableEditor } from "./editors";
import { LoraAddSheet } from "./lora-add";
import { FixedLorasSheet } from "./fixed-loras";
import { TestResult, type TestRun } from "./test-result";

interface Form {
  /** 実行するセット(複数可) */
  setIds: string[];
  lora: string | null;
  physical: string[];
  /** シーンはセットごとに決める(セット id → シーン id) */
  scenes: Record<string, string | null>;
  /** セットごとの、実行対象に選んだプリセット。無ければ全部 */
  checked: Record<string, string[]>;
  /** null = 設定タブの既定サイズに従う。選んだときだけ、その回の上書き */
  varValues: Record<string, string>;
}

const INITIAL: Form = { setIds: [], lora: null, physical: [], scenes: {}, checked: {}, varValues: {} };
// 初期状態で選ぶセット(名前で探す。なければ先頭のセット)。保存した選択があればそちらを優先する
const DEFAULT_SET_NAMES = ["ペッティング", "標準セット_パターン2", "標準セット_立位", "キスハメセット"];
// 既定の選び方を変えたので、以前の選択は引き継がず、一度だけ初期化する(v4 → v5)
const KEY = "cp2_generate_form_v5";

function loadForm(): Form {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...INITIAL, ...(JSON.parse(raw) as Partial<Form>) } : INITIAL;
  } catch {
    return INITIAL;
  }
}

type Editor =
  | { kind: "preset"; type: PresetType; id: string | null }
  | { kind: "variable"; name: string | null }
  | { kind: "lora"; name: string }
  | { kind: "lora-add" }
  | { kind: "fixed-loras" }
  | { kind: "batch"; setId: string; presetId: string };

interface PlanPreview {
  variables: VariableInfo[];
  items: { label: string; count: number; batchPresetId?: string }[];
}

export function GenerateScreen() {
  const router = useRouter();
  const { data: lib, error, loading, reload } = usePoll<LibraryResponse>("/api/library", null);
  const [form, setForm] = useState<Form>(INITIAL);
  const [ready, setReady] = useState(false);
  const [editors, setEditors] = useState<Editor[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [test, setTest] = useState<TestRun | null>(null);
  const [libVersion, setLibVersion] = useState(0);

  // 前回の選択を復元する。保存先(localStorage)が使えない環境では初期値のまま動く。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(loadForm());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<Form>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // 選ばれているセット。保存済みの id が消えていたら外し、何も選ばれていなければ既定のセットを使う
  const activeSets = useMemo(() => {
    if (!lib) return [];
    const chosen = lib.sets.filter((s) => form.setIds.includes(s.id));
    if (chosen.length > 0) return chosen;
    const defaults = DEFAULT_SET_NAMES.map((n) => lib.sets.find((s) => s.name === n)).filter((s): s is (typeof lib.sets)[number] => !!s);
    return defaults.length > 0 ? defaults : lib.sets.slice(0, 1);
  }, [lib, form.setIds]);

  const idsFor = useCallback(
    (set: LibraryResponse["sets"][number]) => {
      const valid = form.checked[set.id]?.filter((id) => set.presets.some((p) => p.id === id));
      return valid ?? set.presets.map((p) => p.id);
    },
    [form.checked],
  );

  const request = useMemo<PlanRequest | null>(() => {
    const sets = activeSets.map((s) => ({ setId: s.id, presetIds: idsFor(s), sceneId: form.scenes[s.id] ?? null })).filter((s) => s.presetIds.length > 0);
    if (sets.length === 0) return null;
    return {
      mode: "batch",
      variableValues: form.varValues,
      batch: { sets, loraName: form.lora, physicalIds: form.physical },
    };
  }, [activeSets, idsFor, form.lora, form.physical, form.scenes, form.varValues]);

  // 選択が変わるたびに、参照している変数と作られるアイテムを取り直す(連打に備えて少し待つ)
  const reqKey = JSON.stringify(request);
  const lastKey = useRef("");
  useEffect(() => {
    if (!request) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      return;
    }
    const key = `${reqKey}:${libVersion}`;
    if (key === lastKey.current) return;
    const timer = setTimeout(() => {
      lastKey.current = key;
      api<PlanPreview>("/api/plan", "POST", { action: "preview", request })
        .then((p) => {
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => setPreviewError(e instanceof Error ? e.message : "確認できませんでした"));
    }, 250);
    return () => clearTimeout(timer);
  }, [reqKey, request, libVersion]);

  const selectedCount = request?.batch?.sets.reduce((n, s) => n + (s.presetIds?.length ?? 0), 0) ?? 0;
  const totalImages = activeSets.reduce((sum, set) => {
    const ids = idsFor(set);
    return sum + set.presets.filter((p) => ids.includes(p.id)).reduce((s, p) => s + p.batchCount, 0);
  }, 0);

  const refresh = useCallback(async () => {
    await reload();
    setLibVersion((v) => v + 1);
  }, [reload]);

  const openEditor = useCallback((e: Editor) => setEditors((s) => [...s, e]), []);
  const closeEditor = useCallback(() => setEditors((s) => s.slice(0, -1)), []);

  async function addToQueue() {
    if (!request) return;
    setAdding(true);
    try {
      const r = await api<{ entries: number; images: number }>("/api/plan", "POST", { action: "add", request });
      toast.success(`${r.entries}件・${r.images}枚を保留に追加しました`, {
        description: "「キュー」タブの「開始」を押すまで生成は始まりません",
        action: { label: "キューを開く", onClick: () => router.push("/queue") },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "追加できませんでした");
    } finally {
      setAdding(false);
    }
  }

  async function runTest(presetId?: string) {
    if (!request) return;
    try {
      const r = await api<{ promptId: string; label: string }>("/api/plan", "POST", { action: "test", request, presetId });
      setTest({ promptId: r.promptId, label: r.label, presetId: presetId ?? null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "テスト生成できませんでした");
    }
  }

  /** いま入力している値を、その変数の既定値として v1 と共有のライブラリへ保存する */
  async function saveDefault(v: VariableInfo, value: string) {
    try {
      await api("/api/library/edit", "POST", {
        action: "save-variable",
        def: { name: v.name, mode: v.defined ? v.mode : "input", value, candidates: v.candidates },
      });
      toast.success(`%%${v.name}%% の既定値を保存しました`);
      update({ varValues: Object.fromEntries(Object.entries(form.varValues).filter(([k]) => k !== v.name)) });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
    }
  }

  if (loading || !ready) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }
  if (error || !lib) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>プリセットを読み込めませんでした</h2>
          <p className="label">{error ?? "データがありません"}</p>
          <p className="label">PC 側で comfy-pipeline のプリセット保存先(data/library)が読めるか確認してください。</p>
          <Button onClick={() => void reload()}>再読み込み</Button>
        </div>
      </div>
    );
  }
  if (activeSets.length === 0) {
    return (
      <div className="page">
        <div className="panel panel-body">
          <h2>一括キューのセットがありません</h2>
          <p className="label">comfy-pipeline(PC版)の「一括キュー」でセットを作ると、ここに表示されます。</p>
        </div>
      </div>
    );
  }

  const loraItems: PickItem[] = lib.loras.map((l) => ({ id: l.name, name: l.name, note: l.promptOnly ? "タグのみ" : undefined }));
  const setItems: PickItem[] = lib.sets.map((s) => ({ id: s.id, name: s.name, note: `${s.presets.length}件` }));
  const addOf = (type: PresetType) => () => openEditor({ kind: "preset", type, id: null });
  const editOf = (type: PresetType) => (id: string) => openEditor({ kind: "preset", type, id });
  const variables = preview?.variables ?? [];
  const missingInput = variables.some((v) => v.mode === "input" && !v.value && !form.varValues[v.name]);
  const multi = activeSets.length > 1;

  return (
    <div className="page wide">
      <div className="cols">
        <div className="stack">
          <section className="seams" aria-label="セットと素材">
            <Picker
              label="セット"
              multiple
              items={setItems}
              value={activeSets.map((s) => s.id)}
              onChange={(ids) => update({ setIds: ids })}
            />
            <Picker
              label="LoRA"
              items={loraItems}
              value={form.lora}
              onChange={(v) => update({ lora: v })}
              emptyText="LoRAが登録されていません"
              onEditItem={(name) => openEditor({ kind: "lora", name })}
              onAdd={() => openEditor({ kind: "lora-add" })}
            />
            <button type="button" className="row w-full text-left" onClick={() => openEditor({ kind: "fixed-loras" })} style={{ background: "var(--color-paper-2)", border: 0, color: "inherit" }}>
              <span className="label" style={{ width: "5.5em", flexShrink: 0 }}>固定LoRA</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: lib.fixedLoras.length ? "var(--color-ink)" : "var(--color-muted)" }}>
                {lib.fixedLoras.length ? lib.fixedLoras.map((l) => l.name).join("、") : "なし"}
              </span>
              <ChevronRight size={18} aria-hidden style={{ color: "var(--color-muted)" }} />
            </button>
            <Picker
              label="身体"
              multiple
              items={lib.physical}
              categories={lib.categories}
              value={form.physical}
              onChange={(v) => update({ physical: v })}
              onEditItem={editOf("physical")}
              onAdd={addOf("physical")}
            />
          </section>

          {activeSets.map((set) => {
            const selectedIds = idsFor(set);
            return (
              <section key={set.id} aria-label={`${set.name}のプリセット`}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", padding: "0 0 var(--space-xs)" }}>
                  <h2 className="label" style={{ fontSize: "var(--text-sm)", maxWidth: "none", minWidth: 0, overflowWrap: "anywhere" }}>
                    {multi ? set.name : "プリセット"} <span className="measured">{selectedIds.length}/{set.presets.length}</span>
                  </h2>
                  <div style={{ display: "flex", gap: "var(--space-xs)", flexShrink: 0 }}>
                    <button type="button" className="chip" onClick={() => update({ checked: { ...form.checked, [set.id]: set.presets.map((p) => p.id) } })}>
                      すべて選ぶ
                    </button>
                    <button type="button" className="chip" onClick={() => update({ checked: { ...form.checked, [set.id]: [] } })}>
                      外す
                    </button>
                  </div>
                </div>
                <div className="seams" style={{ marginBottom: "var(--space-sm)" }}>
                  <Picker
                    label="シーン"
                    items={lib.scene}
                    categories={lib.categories}
                    value={form.scenes[set.id] ?? null}
                    onChange={(v) => update({ scenes: { ...form.scenes, [set.id]: v } })}
                    onEditItem={editOf("scene")}
                    onAdd={addOf("scene")}
                  />
                </div>
                <ul className="seams" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {set.presets.map((p) => {
                    const on = selectedIds.includes(p.id);
                    const summary = [p.count, p.pose, p.scene].filter(Boolean).join(" · ");
                    return (
                      <li key={p.id} style={{ display: "flex", alignItems: "center" }}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            update({ checked: { ...form.checked, [set.id]: on ? selectedIds.filter((id) => id !== p.id) : [...selectedIds, p.id] } })
                          }
                          className="text-left"
                          style={{ flex: 1, minWidth: 0, minHeight: 56, display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-xs) var(--space-md)", background: "transparent", border: 0, color: on ? "var(--color-ink)" : "var(--color-muted)" }}
                        >
                          <span className="check" data-on={on} aria-hidden>
                            {on && <Check size={16} strokeWidth={3} />}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", overflowWrap: "anywhere" }}>{p.name}</span>
                            <span className="label" style={{ display: "block", fontSize: "var(--text-xs)" }}>
                              {summary || "組み合わせなし"}
                            </span>
                          </span>
                        </button>
                        <span className="measured" style={{ color: "var(--color-muted)" }}>×{p.batchCount}</span>
                        <Button variant="ghost" size="icon" aria-label={`${p.name}で1枚テスト`} onClick={() => void runTest(p.id)}>
                          <FlaskConical />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`${p.name}を編集`} onClick={() => openEditor({ kind: "batch", setId: set.id, presetId: p.id })}>
                          <Pencil />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="stack">
          {test && <TestResult key={test.promptId} run={test} onClose={() => setTest(null)} onRetry={() => void runTest(test.presetId ?? undefined)} onReplace={(promptId) => setTest({ ...test, promptId })} />}

          <section className="panel" aria-label="変数">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="label" style={{ fontSize: "var(--text-sm)", maxWidth: "none" }}>
                変数 <span className="measured">%%name%%</span>
              </h2>
              <Button variant="ghost" size="sm" onClick={() => openEditor({ kind: "variable", name: null })}>
                <Plus /> 追加
              </Button>
            </div>
            {previewError && <p className="label" role="alert" style={{ padding: "0 var(--space-md) var(--space-sm)", color: "var(--color-bad)" }}>{previewError}</p>}
            {variables.length === 0 && !previewError && (
              <p className="label" style={{ padding: "0 var(--space-md) var(--space-md)" }}>
                選んだプリセットに変数は使われていません。
              </p>
            )}
            {variables.map((v) => (
              <VariableRow
                key={v.name}
                v={v}
                value={form.varValues[v.name] ?? ""}
                onValue={(val) => update({ varValues: { ...form.varValues, [v.name]: val } })}
                onSaveDefault={(val) => void saveDefault(v, val)}
                onEdit={() => openEditor({ kind: "variable", name: v.name })}
              />
            ))}
          </section>
        </div>
      </div>

      <div className="action-bar">
        <Button variant="outline" size="lg" disabled={selectedCount === 0} onClick={() => void runTest()} aria-label="選んだプリセットからランダムに1枚テスト生成">
          <Shuffle /> テスト
        </Button>
        <Button size="lg" className="flex-1" disabled={adding || selectedCount === 0} onClick={() => void addToQueue()}>
          <Layers />
          {adding ? "追加中…" : `保留に追加 (${totalImages}枚)`}
        </Button>
      </div>
      {missingInput && <p className="label" style={{ textAlign: "center" }}>未入力の変数があります(空のまま生成されます)</p>}

      {editors.map((e, i) => {
        const key = `${i}-${e.kind}`;
        if (e.kind === "preset")
          return <PresetEditor key={key} type={e.type} id={e.id} categories={lib.categories} onClose={closeEditor} onSaved={() => void refresh()} />;
        if (e.kind === "variable") return <VariableEditor key={key} name={e.name} onClose={closeEditor} onSaved={() => void refresh()} />;
        if (e.kind === "fixed-loras") return <FixedLorasSheet key={key} onClose={closeEditor} onChanged={() => void refresh()} />;
        if (e.kind === "lora-add")
          return (
            <LoraAddSheet
              key={key}
              onClose={closeEditor}
              onAdded={(name) => {
                update({ lora: name });
                void refresh();
              }}
            />
          );
        if (e.kind === "lora") return <LoraEditor key={key} name={e.name} onClose={closeEditor} onSaved={() => void refresh()} />;
        return (
          <BatchPresetEditor
            key={key}
            setId={e.setId}
            presetId={e.presetId}
            lib={lib}
            onClose={closeEditor}
            onSaved={() => void refresh()}
            onEditPreset={(type, id) => openEditor({ kind: "preset", type, id })}
          />
        );
      })}
    </div>
  );
}

function VariableRow({ v, value, onValue, onSaveDefault, onEdit }: {
  v: VariableInfo;
  value: string;
  onValue: (s: string) => void;
  onSaveDefault: (value: string) => void;
  onEdit: () => void;
}) {
  const modeLabel = v.mode === "fixed" ? "固定" : v.mode === "random" ? "ランダム" : "入力";
  const canSave = v.mode === "input" && value.trim() !== "" && value.trim() !== v.value;
  return (
    <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <span style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 8em" }}>
        <span className="measured" style={{ overflowWrap: "anywhere" }}>{v.name}</span>
        <span className="label" style={{ fontSize: "var(--text-xs)" }}>
          {modeLabel}
          {!v.defined && " · 未定義"}
        </span>
      </span>
      <span style={{ flex: "2 1 10em", minWidth: 0, display: "grid", gap: "var(--space-xs)" }}>
        {v.mode === "input" ? (
          <>
            <TagField value={value} onChange={onValue} placeholder={v.value || "値を入力(タグを検索できます)"} aria-label={`${v.name}の値`} />
            {v.value && !value && (
              <span className="label" style={{ fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>
                既定値: <span className="measured">{v.value}</span>(空のままならこれを使います)
              </span>
            )}
            {v.candidates.length > 0 && (
              <span style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
                {v.candidates.slice(0, 12).map((c) => (
                  <button key={c} type="button" className="chip" aria-pressed={value === c} onClick={() => onValue(value === c ? "" : c)}>
                    {c}
                  </button>
                ))}
              </span>
            )}
            {canSave && (
              <Button variant="outline" size="sm" onClick={() => onSaveDefault(value.trim())}>
                <Save /> この値を既定にする
              </Button>
            )}
          </>
        ) : v.mode === "fixed" ? (
          <span style={{ overflowWrap: "anywhere" }}>{v.value || <span className="label">(空)</span>}</span>
        ) : (
          <span className="label">候補 {v.candidates.length} 件から1枚ごとに抽選</span>
        )}
      </span>
      <Button variant="ghost" size="icon" aria-label={`${v.name}を編集`} onClick={onEdit}>
        <Pencil />
      </Button>
    </div>
  );
}
