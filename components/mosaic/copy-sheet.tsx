"use client";

import { useState } from "react";
import { FolderInput } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScreenSheet } from "@/components/shell/screen-sheet";

const KEY = "cp2_release_copy_names";

/** Windows のフォルダ名に使えない文字を除く(サーバー側 lib/comfy/release-copy.ts と同じ規則。そちらは node の path を使うのでここでは複製) */
const sanitizeFolderName = (name: string) => name.replace(/[\/:*?"<>|]/g, "").trim();

function load(): { character: string; group: string } {
  try {
    return { character: "", group: "", ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as object) };
  } catch {
    return { character: "", group: "" };
  }
}

/**
 * モザイク処理済みの画像を、リリース用フォルダ(<ルート>/YYYYMM/YYYYMMDD_作品名/グループ名/)へ 01,02,… の連番でコピーする。
 * 「リリース」タブは、ここに集めた画像からPDF・ZIP・Pixiv用セットを作る。
 */
export function CopySheet({ paths, releaseRoot, onClose }: { paths: string[]; releaseRoot: string; onClose: () => void }) {
  const [names, setNames] = useState(load);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ copied: number; destDir: string; firstName: string; lastName: string } | null>(null);

  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const c = sanitizeFolderName(names.character);
  const g = sanitizeFolderName(names.group);
  const preview = `${releaseRoot.replace(/[\\/]+$/, "")}\\${ymd.slice(0, 6)}\\${ymd}_${c || "作品名"}\\${g || "グループ名"}`;

  async function copy() {
    setBusy(true);
    try {
      try {
        localStorage.setItem(KEY, JSON.stringify(names));
      } catch {}
      const r = await api<{ copied: number; destDir: string; firstName: string; lastName: string }>("/api/mosaic/copy", "POST", { paths, character: names.character, group: names.group });
      setDone(r);
      toast.success(`${r.copied}枚をコピーしました`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "コピーできませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenSheet
      title="リリース用フォルダへコピー"
      onClose={onClose}
      footer={
        done ? (
          <Button size="lg" className="flex-1" onClick={onClose}>
            閉じる
          </Button>
        ) : (
          <Button size="lg" className="flex-1" disabled={busy || !c || !g} onClick={() => void copy()}>
            <FolderInput /> {busy ? "コピー中…" : `${paths.length}枚をコピー`}
          </Button>
        )
      }
    >
      {done ? (
        <section className="panel panel-body" aria-live="polite">
          <p>
            <span className="measured">{done.copied}</span> 枚を <span className="measured">{done.firstName}</span> 〜 <span className="measured">{done.lastName}</span> としてコピーしました。
          </p>
          <p className="measured" style={{ overflowWrap: "anywhere", color: "var(--color-muted)" }}>{done.destDir}</p>
          <p className="label">「リリース」タブで、PDF・ZIP・Pixiv用のセットを作れます。</p>
        </section>
      ) : (
        <>
          <p className="label">前戯・本番など、グループごとに分けて何回かに分けてコピーします。すでに連番の画像があるときは、その続きの番号から振ります(上書きしません)。</p>
          <div style={{ display: "grid", gap: "var(--space-xs)" }}>
            <label htmlFor="cp-character" className="label">作品名(例: キャラクター名)</label>
            <Input id="cp-character" value={names.character} onChange={(e) => setNames({ ...names, character: e.target.value })} placeholder="ノルムー（マイクロビキニ）" />
          </div>
          <div style={{ display: "grid", gap: "var(--space-xs)" }}>
            <label htmlFor="cp-group" className="label">グループ名</label>
            <Input id="cp-group" value={names.group} onChange={(e) => setNames({ ...names, group: e.target.value })} placeholder="前戯・フェラ" />
          </div>
          <div className="panel panel-body">
            <span className="label">コピー先</span>
            <p className="measured" style={{ overflowWrap: "anywhere" }}>{preview}</p>
          </div>
        </>
      )}
    </ScreenSheet>
  );
}
