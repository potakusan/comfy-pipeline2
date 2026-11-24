"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Tags } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import { mergeTags } from "@/lib/comfy/danbooru-tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenSheet } from "@/components/shell/screen-sheet";
import { TagField } from "@/components/shell/tag-field";

interface LocalLora {
  fileName: string;
  name: string;
  trainedWords: string[];
}

/** Civitai のトリガーワードは、そのまま(重みや括弧も崩さず)後ろに足す。すでにあれば足さない。 */
export function appendWord(existing: string, word: string): string {
  const have = existing.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return have.includes(word) ? existing : [...have, word].join(", ");
}

const mono = { fontFamily: "var(--font-outlier)", fontSize: "var(--text-sm)" } as const;

/** Danbooru の投稿 URL からキャラクター・一般タグを取り込む(v1 の「Danbooruからインポート」と同じ)。 */
export function DanbooruImport({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ character: string[]; copyright: string[]; general: string[] }>(`/api/danbooru/tags?url=${encodeURIComponent(url)}`, "GET");
      const tags = [...r.character, ...r.general];
      if (tags.length === 0) {
        setError("キャラクター/一般タグが見つかりませんでした");
        return;
      }
      onChange(mergeTags(value, tags));
      toast.success(`${tags.length}個のタグを取り込みました`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り込めませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-xs)" }}>
      <label className="label" htmlFor="dbr-url">Danbooru からタグを取り込む</label>
      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
        <Input id="dbr-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://danbooru.donmai.us/posts/12345" inputMode="url" />
        <Button variant="outline" size="lg" disabled={busy || !url.trim()} onClick={() => void run()}>
          <Download /> {busy ? "取得中…" : "取り込む"}
        </Button>
      </div>
      {error && <p role="alert" style={{ color: "var(--color-bad)" }}>{error}</p>}
      <p className="label" style={{ fontSize: "var(--text-xs)" }}>
        キャラクター名と一般タグを、いまのトリガーワードの後ろに足します(重複は足しません。_ は空白に、括弧は \( \) にします)。
      </p>
    </div>
  );
}

/**
 * 生成画面の「LoRA」リストに、LoRA(ファイル)か「タグのみ」の項目を追加する。
 * initial を渡すと、そのファイルを選んだ状態で開く(LoRA 画面から)。
 */
export function LoraAddSheet({
  initial,
  onClose,
  onAdded,
}: {
  initial?: { name: string; trainedWords: string[] };
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const [promptOnly, setPromptOnly] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [words, setWords] = useState(initial?.trainedWords.join(", ") ?? "");
  const [trained, setTrained] = useState<string[]>(initial?.trainedWords ?? []);
  const [strength, setStrength] = useState(1);
  const [clip, setClip] = useState(1);
  const [families, setFamilies] = useState<("sdxl" | "anima")[]>(["sdxl"]);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<LocalLora[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (initial) return;
    api<{ items: LocalLora[] }>("/api/loras", "GET")
      .then((r) => setFiles(r.items))
      .catch(() => setFiles([]));
  }, [initial]);

  const shown = useMemo(() => {
    const k = filter.trim().toLowerCase();
    return (files ?? []).filter((f) => !k || f.fileName.toLowerCase().includes(k) || f.name.toLowerCase().includes(k)).slice(0, 80);
  }, [files, filter]);

  const choose = (f: LocalLora) => {
    setName(f.fileName.replace(/\.(safetensors|ckpt|pt)$/i, ""));
    setTrained(f.trainedWords);
    setWords(f.trainedWords.join(", "));
  };

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ name: string }>("/api/library/edit", "POST", { action: "add-lora", lora: { name, strength, clipStrength: clip, triggerWords: words, promptOnly, families } });
      toast.success(promptOnly ? "タグのみの項目を追加しました" : "LoRA をリストに追加しました");
      onAdded(r.name);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "追加できませんでした");
    } finally {
      setSaving(false);
    }
  }

  const fileMode = !promptOnly;
  const needsFile = fileMode && !initial;
  return (
    <ScreenSheet
      title="LoRA をリストに追加"
      onClose={onClose}
      footer={
        <Button size="lg" className="flex-1" disabled={saving || !name.trim()} onClick={() => void save()}>
          {saving ? "追加中…" : "追加"}
        </Button>
      }
    >
      {!initial && (
        <div role="group" aria-label="種類" style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          <button type="button" className="chip" style={{ minHeight: 44 }} aria-pressed={fileMode} onClick={() => setPromptOnly(false)}>
            LoRA ファイル
          </button>
          <button type="button" className="chip" style={{ minHeight: 44 }} aria-pressed={promptOnly} onClick={() => setPromptOnly(true)}>
            <Tags size={16} aria-hidden style={{ marginRight: 6 }} />
            タグのみ
          </button>
        </div>
      )}

      {needsFile && (
        <div style={{ display: "grid", gap: "var(--space-xs)" }}>
          <label className="label" htmlFor="la-filter">LoRA ファイルを選ぶ</label>
          <Input id="la-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ファイル名で絞り込み" />
          {files === null ? (
            <Skeleton className="h-24 w-full" />
          ) : files.length === 0 ? (
            <p className="label">LoRA フォルダにファイルがありません。</p>
          ) : (
            <ul className="seams" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "34dvh", overflowY: "auto" }}>
              {shown.map((f) => (
                <li key={f.fileName}>
                  <button type="button" className="row" aria-pressed={name === f.fileName.replace(/\.(safetensors|ckpt|pt)$/i, "")} onClick={() => choose(f)} style={{ width: "100%", textAlign: "left", minHeight: 48, font: "inherit", overflowWrap: "anywhere" }}>
                    {f.fileName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        <label className="label" htmlFor="la-name">{promptOnly ? "タイトル(画像の保存フォルダ名にも使われます)" : "名前(.safetensors は付けない)"}</label>
        <Input id="la-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={promptOnly ? "例: 柊かがみ" : "例: my_character_v1"} readOnly={fileMode && !!initial} style={mono} />
        {promptOnly && <p className="label" style={{ fontSize: "var(--text-xs)" }}>LoRA ファイルは使わず、下のタグだけをプロンプトに足します。</p>}
      </div>

      {fileMode && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)" }}>
            <div style={{ display: "grid", gap: "var(--space-xs)" }}>
              <label className="label" htmlFor="la-str">強度</label>
              <Input id="la-str" type="number" inputMode="decimal" step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
            </div>
            <div style={{ display: "grid", gap: "var(--space-xs)" }}>
              <label className="label" htmlFor="la-clip">CLIP強度</label>
              <Input id="la-clip" type="number" inputMode="decimal" step={0.05} value={clip} onChange={(e) => setClip(Number(e.target.value))} />
            </div>
          </div>
          <div role="group" aria-label="対応系統" style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center", flexWrap: "wrap" }}>
            <span className="label">対応系統</span>
            {(["sdxl", "anima"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="chip"
                aria-pressed={families.includes(f)}
                onClick={() => setFamilies((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}
              >
                {f === "sdxl" ? "SDXL" : "Anima"}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        <label className="label" htmlFor="la-words">トリガーワード・タグ</label>
        <TagField multiline id="la-words" value={words} onChange={setWords} rows={7} style={mono} />
        {trained.length > 0 && (
          <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
            <span className="label" style={{ width: "100%", fontSize: "var(--text-xs)" }}>Civitai のワード(タップで追加)</span>
            {trained.map((w) => (
              <button key={w} type="button" className="chip" onClick={() => setWords(appendWord(words, w))} style={{ minHeight: 40, overflowWrap: "anywhere", textAlign: "left" }}>
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      <DanbooruImport value={words} onChange={setWords} />
    </ScreenSheet>
  );
}
