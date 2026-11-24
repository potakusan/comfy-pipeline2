"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, FolderInput, Wand2 } from "lucide-react";
import { usePoll } from "@/lib/client/use-poll";
import type { MosaicAlbum, MosaicImage } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { MosaicEditor } from "./editor";
import { RunSheet } from "./run-sheet";
import { CopySheet } from "./copy-sheet";
import { ResetReleaseButton } from "./reset-button";

const SIZE_KEY = "cp2_mosaic_thumb";

/** アルバム一覧 → アルバム(元画像とモザイク済みの対応)。開いているアルバムは URL(?album=)に持つ。 */
export function MosaicScreen() {
  const album = useSearchParams().get("album");
  return album ? <AlbumView album={album} /> : <AlbumList />;
}

function AlbumList() {
  const { data, error, loading, reload } = usePoll<{ albums: MosaicAlbum[] }>("/api/mosaic/albums", null);

  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>アルバムを読み込めません</h2>
          <p className="label">{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }
  if (data.albums.length === 0) {
    return (
      <div className="page">
        <div className="panel panel-body">
          <h2>モザイク処理するアルバムがありません</h2>
          <p className="label">「ギャラリー」でリリースに選んだ画像が、ここに並びます。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <p className="label">ギャラリーで「リリース選択」した画像に、縮小とモザイクをかけて仕上げます。</p>
      <ul className="cardgrid">
        {data.albums.map((a) => (
          <li key={a.name}>
            <Link href={`/mosaic?album=${encodeURIComponent(a.name)}`} className="card">
              <span className="card-thumb">
                {a.firstImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/gallery/thumb?path=${encodeURIComponent(a.firstImage)}`} alt="" loading="lazy" />
                )}
              </span>
              <span className="card-body">
                <span className="card-title">{a.name}</span>
                <span className="measured" style={{ color: "var(--color-muted)" }}>
                  元 {a.sourceCount}枚 ／ <span style={{ color: a.mosaicCount >= a.sourceCount ? "var(--color-ok)" : "var(--color-accent)" }}>処理済み {a.mosaicCount}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Filter = "all" | "pending" | "done";

function Tile({ img, onOpen }: { img: MosaicImage; onOpen: () => void }) {
  const shown = img.mosaic ?? img.source;
  return (
    <button type="button" onClick={onOpen} className="gthumb" aria-label={`${img.filename}: ${img.mosaic ? "タップでモザイクを確認・調整" : "未処理。タップで処理"}`}>
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/gallery/thumb?path=${encodeURIComponent(shown.path)}&v=${shown.v}`} alt="" loading="lazy" draggable={false} />
      )}
      {!img.mosaic && <span className="gthumb-badge" style={{ background: "var(--color-paper-3)", color: "var(--color-accent)", border: "var(--rule-hair) solid var(--color-accent)" }}>未処理</span>}
    </button>
  );
}

function AlbumView({ album }: { album: string }) {
  const { data, error, loading, reload } = usePoll<{ images: MosaicImage[] }>(`/api/mosaic/images?folder=${encodeURIComponent(album)}`, null);
  const { data: albums } = usePoll<{ releaseRoot: string }>("/api/mosaic/albums", null);
  const [filter, setFilter] = useState<Filter>("all");
  const [thumb, setThumb] = useState(160);
  const [editing, setEditing] = useState<string | null>(null);
  const [run, setRun] = useState<{ files?: string[] } | null>(null);
  const [copy, setCopy] = useState(false);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v >= 90 && v <= 420) setThumb(v);
    } catch {}
  }, []);

  const images = useMemo(() => data?.images ?? [], [data]);
  const pending = useMemo(() => images.filter((i) => !i.mosaic && i.source).map((i) => i.filename), [images]);
  const shown = images.filter((i) => (filter === "pending" ? !i.mosaic : filter === "done" ? !!i.mosaic : true));
  const done = images.filter((i) => i.mosaic);
  // コピーは、処理済みのすべて(元の画像ごとに最新の1枚)。一部だけ選ぶ操作はない
  const copyPaths = done.map((i) => i.mosaic!.path);
  const donePaths = copyPaths;
  const editIndex = editing ? donePaths.indexOf(editing) : -1;

  const refresh = useCallback(() => void reload(), [reload]);

  return (
    <div className="page wide gallery-page">
      <h2 style={{ minWidth: 0, fontSize: "var(--text-lg)", maxWidth: "none", overflowWrap: "anywhere" }}>{album}</h2>

      <div className="gallery-controls">
        <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/mosaic" className="chip gallery-back" aria-label="アルバム一覧へ戻る">
            <ChevronLeft size={18} aria-hidden />
            <span>一覧</span>
          </Link>
          {(["all", "pending", "done"] as const).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "すべて" : f === "pending" ? "未処理" : "処理済み"}{" "}
              <span className="measured" style={{ marginLeft: 6 }}>{f === "all" ? images.length : f === "pending" ? pending.length : done.length}</span>
            </button>
          ))}
        </div>
        <div className="gallery-size">
          <span className="label" id="mosaic-size">サイズ</span>
          <Slider
            aria-labelledby="mosaic-size"
            aria-label="サムネイルの大きさ"
            min={90}
            max={420}
            step={10}
            value={[thumb]}
            onValueChange={([v]) => setThumb(v)}
            onValueCommit={([v]) => {
              try {
                localStorage.setItem(SIZE_KEY, String(v));
              } catch {}
            }}
          />
          <span className="measured" style={{ minWidth: "3.5em", textAlign: "right" }}>{thumb}px</span>
        </div>
      </div>

      <p className="label" style={{ fontSize: "var(--text-xs)" }}>タップ: モザイクを確認・調整(前後の画像へ送れます)。コピーは、処理済みのすべてが対象です。</p>

      {loading && <Skeleton className="h-64 w-full" />}
      {error && (
        <div className="panel panel-body" role="alert">
          <p>{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      )}
      {!loading && !error && shown.length === 0 && (
        <div className="panel panel-body">
          <p className="label">{filter === "pending" ? "未処理の画像はありません。" : filter === "done" ? "処理済みの画像はまだありません。" : "画像がありません。"}</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="gallery-grid" style={{ ["--thumb" as string]: `${thumb}px` }}>
          {shown.map((img) => (
            <Tile key={img.filename} img={img} onOpen={() => (img.mosaic ? setEditing(img.mosaic.path) : setRun({ files: [img.filename] }))} />
          ))}
        </div>
      )}

      <div className="action-bar">
        <Button variant="outline" size="lg" className="flex-1" onClick={() => setRun({})} disabled={images.length === 0}>
          <Wand2 /> 一括処理
        </Button>
        <Button size="lg" className="flex-1" onClick={() => setCopy(true)} disabled={copyPaths.length === 0}>
          <FolderInput /> コピー ({copyPaths.length}枚)
        </Button>
        <ResetReleaseButton folder={album} variant="button" onDone={() => (window.location.href = "/mosaic")} />
      </div>

      {editing && editIndex >= 0 && (
        <MosaicEditor
          key={editing}
          path={editing}
          album={album}
          sourceName={images.find((i) => i.mosaic?.path === editing)?.source?.path.split("/").pop() ?? null}
          index={editIndex}
          total={donePaths.length}
          onNavigate={(d) => setEditing(donePaths[editIndex + d] ?? editing)}
          onChanged={refresh}
          onReplaced={(newPath) => void reload().then(() => setEditing(newPath))}
          onRemoved={() => {
            // 外した画像の、次(なければ前)の画像へ。なければ閉じる
            const next = donePaths[editIndex + 1] ?? donePaths[editIndex - 1] ?? null;
            void reload().then(() => setEditing(next));
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {run && (
        <RunSheet
          album={album}
          files={run.files}
          unprocessed={pending}
          total={images.filter((i) => i.source).length}
          onClose={() => setRun(null)}
          onDone={refresh}
        />
      )}
      {copy && <CopySheet paths={copyPaths} releaseRoot={albums?.releaseRoot ?? ""} onClose={() => setCopy(false)} />}
    </div>
  );
}
