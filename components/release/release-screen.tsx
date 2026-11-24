"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Copy, Crop, Download, GripVertical, FileArchive, FileText, Package, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import { useLongPress } from "@/lib/client/use-long-press";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Viewer, type ViewerImage } from "@/components/gallery/viewer";
import { JobPanel } from "./job-panel";
import { ThumbCrop } from "./thumb-crop";
import { boothLine, pixivCaption, pixivSaveNames } from "@/lib/comfy/pixiv-names";

interface WorkSummary {
  name: string;
  groups: number;
  images: number;
  firstImage: string | null;
  pdfs: number;
  hasZip: boolean;
  pixivFiles: number;
}
interface OutputFile {
  name: string;
  size: number;
  path: string;
  kind: "pdf" | "zip" | "pixiv";
}
interface WorkDetail {
  month: string;
  name: string;
  groups: { name: string; files: { name: string; path: string; v: number }[] }[];
  outputs: OutputFile[];
}

const SIZE_KEY = "cp2_release_thumb";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const fileUrl = (kind: "work" | "out", month: string, p: string, extra = "") => `/api/release/file?kind=${kind}&month=${month}&path=${encodeURIComponent(p)}${extra}`;

/** 作品一覧 → 作品(画像の確認・Pixiv用の選択・PDF/ZIP・ダウンロード)。開いている作品は URL(?month=&work=)に持つ。 */
export function ReleaseScreen() {
  const q = useSearchParams();
  const work = q.get("work");
  const month = q.get("month");
  return work && month ? <WorkView month={month} work={work} /> : <WorksList month={month} />;
}

function WorksList({ month }: { month: string | null }) {
  const { data, error, loading, reload } = usePoll<{ root: string; months: string[]; month: string | null; works: WorkSummary[] }>(`/api/release/works${month ? `?month=${month}` : ""}`, null);

  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>リリース用フォルダを読み込めません</h2>
          <p className="label">{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }
  if (data.months.length === 0) {
    return (
      <div className="page">
        <div className="panel panel-body">
          <h2>リリース用の作品がありません</h2>
          <p className="label">「モザイク」タブで仕上げた画像を「リリース用フォルダへコピー」すると、ここに作品が並びます。</p>
          <p className="measured" style={{ overflowWrap: "anywhere", color: "var(--color-muted)" }}>{data.root}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="page wide">
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }} role="group" aria-label="月">
        {data.months.map((m) => (
          <Link key={m} href={`/release?month=${m}`} className="chip" aria-pressed={m === data.month} style={{ minHeight: 44, textDecoration: "none" }}>
            <span className="measured">{m.slice(0, 4)}/{m.slice(4)}</span>
          </Link>
        ))}
      </div>
      {data.works.length === 0 ? (
        <div className="panel panel-body">
          <p className="label">この月に作品はありません。</p>
        </div>
      ) : (
        <ul className="cardgrid">
          {data.works.map((w) => (
            <li key={w.name}>
              <Link href={`/release?month=${data.month}&work=${encodeURIComponent(w.name)}`} className="card">
                <span className="card-thumb">
                  {w.firstImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl("work", data.month!, w.firstImage, "&w=400")} alt="" loading="lazy" />
                  )}
                </span>
                <span className="card-body">
                  <span className="card-title">{w.name}</span>
                  <span className="measured" style={{ color: "var(--color-muted)" }}>{w.groups}グループ ／ {w.images}枚</span>
                  <span style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    <span className="chip" data-on={w.pdfs > 0}>PDF {w.pdfs}</span>
                    <span className="chip" data-on={w.hasZip}>ZIP {w.hasZip ? "あり" : "なし"}</span>
                    <span className="chip" data-on={w.pixivFiles > 0}>Pixiv {w.pixivFiles > 0 ? `${w.pixivFiles}枚` : "なし"}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Tab = "images" | "pixiv" | "files";

function PickTile({ img, order, onToggle, onOpen, month }: { img: { path: string; name: string }; order: number; onToggle: () => void; onOpen: () => void; month: string }) {
  const press = useLongPress(onOpen, onToggle);
  return (
    <button type="button" {...press} className="gthumb" data-released={order > 0} aria-pressed={order > 0} aria-label={`${img.name}: タップでPixiv用に選ぶ、長押しで拡大`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fileUrl("work", month, img.path, "&w=480")} alt="" loading="lazy" draggable={false} />
      {order > 0 && (
        <span className="gthumb-badge" aria-label={`${order}番目`}>
          {order}
        </span>
      )}
    </button>
  );
}

/** Booth に追記する一行(コピーしやすいよう、編集もできる入力欄とコピーのボタン) */
function CopyField({ label, text, rows }: { label: string; text: string; rows?: number }) {
  const [value, setValue] = useState(text);
  const id = useId();
  const fieldStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: "var(--rule-hair) solid var(--color-rule)", borderRadius: "var(--radius-pill)", background: "var(--color-paper)", color: "var(--color-ink)", font: "inherit" };
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // クリップボードAPIが使えないとき(HTTP接続など)は、選択してコピーする
      ref.current?.select();
      document.execCommand("copy");
    }
    toast.success("コピーしました");
  }
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "flex-start" }}>
        {rows ? (
          <textarea id={id} ref={ref} rows={rows} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} style={{ ...fieldStyle, padding: "var(--space-xs) var(--space-sm)", resize: "vertical" }} />
        ) : (
          <input id={id} ref={ref} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} style={{ ...fieldStyle, minHeight: 44, padding: "0 var(--space-sm)" }} />
        )}
        <Button variant="outline" size="lg" onClick={() => void copy()}>
          <Copy /> コピー
        </Button>
      </div>
    </div>
  );
}

function WorkView({ month, work }: { month: string; work: string }) {
  const { data, error, loading, reload } = usePoll<WorkDetail>(`/api/release/work?month=${month}&top=${encodeURIComponent(work)}`, null);
  const [tab, setTab] = useState<Tab>("images");
  const [picks, setPicks] = useState<string[]>([]);
  const [thumb, setThumb] = useState(150);
  const [viewer, setViewer] = useState<number | null>(null);
  // 完了した表示は残す(何が起きたか・ログを見返せるように)。実行中かどうかだけ別に持つ
  const [pixivJob, setPixivJob] = useState<{ id: string; running: boolean } | null>(null);
  const [buildJob, setBuildJob] = useState<{ id: string; running: boolean } | null>(null);
  const [wantPdf, setWantPdf] = useState(true);
  const [wantZip, setWantZip] = useState(true);
  const [force, setForce] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const picksKey = `cp2_release_picks:${month}/${work}`;
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v >= 90 && v <= 420) setThumb(v);
      const saved = JSON.parse(localStorage.getItem(picksKey) ?? "[]") as string[];
      setPicks(Array.isArray(saved) ? saved : []);
    } catch {}
  }, [picksKey]);

  const setPicksSaved = (next: string[]) => {
    setPicks(next);
    try {
      localStorage.setItem(picksKey, JSON.stringify(next));
    } catch {}
  };

  const flat = useMemo(() => (data?.groups ?? []).flatMap((g) => g.files.map((f) => ({ key: `${g.name}/${f.name}`, group: g.name, ...f }))), [data]);
  const validPicks = picks.filter((p) => flat.some((f) => f.key === p));
  const viewerImages: ViewerImage[] = flat.map((f) => ({ path: f.path, caption: f.key }));
  const outputs = data?.outputs ?? [];
  const pixiv = outputs.filter((o) => o.kind === "pixiv");
  const thumbFile = pixiv.find((o) => o.name === "0.jpg");
  const setFiles = pixiv.filter((o) => o.name !== "0.jpg");
  const docs = outputs.filter((o) => o.kind !== "pixiv");

  const toggle = (key: string) => {
    if (validPicks.includes(key)) setPicksSaved(validPicks.filter((k) => k !== key));
    else setPicksSaved([...validPicks, key]);
  };

  const refresh = useCallback(() => void reload(), [reload]);

  // ZIP にせず、画像を1枚ずつ続けて保存する(ブラウザは短い間隔を空けないと2枚目以降を止めることがある)
  async function downloadAll(files: OutputFile[]) {
    setDownloading(true);
    try {
      for (const o of files) {
        const a = document.createElement("a");
        const saveAs = saveNames.get(o.name) ?? o.name;
        a.href = fileUrl("out", month, o.path, `&download=1&name=${encodeURIComponent(saveAs)}`);
        a.download = saveAs;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 450));
      }
      toast.success(`${files.length}枚の保存を開始しました`);
    } finally {
      setDownloading(false);
    }
  }

  // サンプル画像の並べ替え(つまみをドラッグ。指・マウスどちらでも)。指の下にある画像の位置へ、ドラッグ中の画像を移す
  const startDrag = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    setDragKey(key);
  };
  const dragOver = (e: PointerEvent) => {
    if (!dragKey) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-pick-index]");
    if (!over) return;
    const to = Number(over.getAttribute("data-pick-index"));
    const from = validPicks.indexOf(dragKey);
    if (Number.isNaN(to) || from < 0 || to === from) return;
    const next = [...validPicks];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setPicksSaved(next);
  };
  // 並べ替えで要素が動くと、つまみに付けたポインターの捕捉が外れることがあるので、window で動きを追う
  useEffect(() => {
    if (!dragKey) return;
    const end = () => setDragKey(null);
    window.addEventListener("pointermove", dragOver);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", dragOver);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  });

  async function makePixiv() {
    const exists = setFiles.length > 0;
    if (exists && !window.confirm("いまあるPixiv用セット(画像と告知タイル)を消して、作り直します。よろしいですか？")) return;
    try {
      const r = await api<{ jobId: string }>("/api/release/pixiv", "POST", { month, top: work, picks: validPicks.length > 0 ? validPicks : undefined, force: exists });
      setPixivJob({ id: r.jobId, running: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "作れませんでした");
    }
  }

  async function makeFiles() {
    try {
      const r = await api<{ jobId: string }>("/api/release/build", "POST", { month, top: work, pdf: wantPdf, zip: wantZip, force });
      setBuildJob({ id: r.jobId, running: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "作れませんでした");
    }
  }

  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>作品を読み込めません</h2>
          <p className="label">{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }

  const saveNames = pixivSaveNames(work, pixiv);
  const totalImages = (data?.groups ?? []).reduce((n, g) => n + g.files.length, 0);
  const booth = pixiv.find((o) => o.name.endsWith("_booth.jpg"));

  return (
    <div className="page wide gallery-page">
      <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "none", overflowWrap: "anywhere" }}>{data.name}</h2>

      <div className="gallery-controls">
        <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center", flexWrap: "wrap" }}>
          <Link href={`/release?month=${month}`} className="chip gallery-back" aria-label="作品一覧へ戻る">
            <ChevronLeft size={18} aria-hidden />
            <span>一覧</span>
          </Link>
          {(
            [
              ["images", "画像"],
              ["pixiv", "Pixiv用"],
              ["files", "PDF・ZIP"],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" className="chip" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {label}
              {t === "pixiv" && validPicks.length > 0 && <span className="measured" style={{ marginLeft: 6 }}>{validPicks.length}</span>}
            </button>
          ))}
        </div>
        {tab === "images" && (
          <div className="gallery-size">
            <span className="label" id="rel-size">サイズ</span>
            <Slider
              aria-labelledby="rel-size"
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
        )}
      </div>

      {tab === "images" && (
        <>
          <p className="label" style={{ fontSize: "var(--text-xs)" }}>
            モザイク処理済みの画像です。タップ: Pixiv用に選ぶ(枚数は自由) ／ 長押し: 拡大して確認
          </p>
          <div className="gallery-main" style={{ ["--thumb" as string]: `${thumb}px` }}>
            {data.groups.map((g) => (
              <section key={g.name} className="ggroup" aria-label={g.name}>
                <h3 className="ggroup-head">
                  <span>{g.name}</span>
                  <span className="measured">{g.files.length}枚</span>
                </h3>
                <div className="gallery-grid">
                  {g.files.map((f) => {
                    const key = `${g.name}/${f.name}`;
                    return <PickTile key={key} img={f} month={month} order={validPicks.indexOf(key) + 1} onToggle={() => toggle(key)} onOpen={() => setViewer(flat.findIndex((x) => x.key === key))} />;
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {tab === "pixiv" && (
        <div className="cols">
          <div className="stack">
            <section className="panel panel-body" aria-label="サムネイル">
              <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>サムネイル(0.jpg)</h3>
              {thumbFile && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl("out", month, thumbFile.path, `&w=360&t=${thumbFile.size}`)} alt="サムネイル 0.jpg" style={{ maxWidth: 220, width: "100%", border: "var(--rule-hair) solid var(--color-rule)", borderRadius: "var(--radius-pill)" }} />
              )}
              <p className="label" style={{ fontSize: "var(--text-xs)" }}>
                Pixiv は正方形でサムネイルを作るので、余白を切って見栄えよくする切り抜きです(縦横比は自由)。
              </p>
              <Button variant="outline" onClick={() => setCropping(true)} disabled={flat.length === 0}>
                <Crop /> {thumbFile ? "切り抜き直す" : "サムネイルを切り抜く"}
              </Button>
            </section>
            <section className="panel panel-body">
              <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>サンプル画像</h3>
              {validPicks.length === 0 ? (
                <p className="label">「画像」タブで選ぶと、その画像(何枚でも)を使います。選ばないときは、プリセットが重ならないようにランダムに9枚を選びます。</p>
              ) : (
                <>
                  <div className="gallery-grid" style={{ ["--thumb" as string]: "88px" }}>
                    {validPicks.map((k, i) => {
                      const f = flat.find((x) => x.key === k)!;
                      return (
                        <div key={k} className="gthumb" data-released="true" data-pick-index={i} data-dragging={dragKey === k} style={{ aspectRatio: "3 / 4", opacity: dragKey === k ? 0.55 : 1 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={fileUrl("work", month, f.path, "&w=240")} alt={k} />
                          <span className="gthumb-badge">{i + 1}</span>
                          <span
                            role="button"
                            aria-label={`${i + 1}番目を移動(ドラッグ)`}
                            onPointerDown={(e) => startDrag(e, k)}
                            style={{ position: "absolute", right: 2, bottom: 2, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 6, background: "var(--color-paper)", border: "var(--rule-hair) solid var(--color-rule)", touchAction: "none", cursor: "grab" }}
                          >
                            <GripVertical size={18} aria-hidden />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="label" style={{ fontSize: "var(--text-xs)" }}>右下のつまみをドラッグすると、順番を入れ替えられます(この順に 01, 02, … と並びます)。</p>
                  <Button variant="outline" onClick={() => setPicksSaved([])}>選択を解除</Button>
                </>
              )}
              <p className="label" style={{ fontSize: "var(--text-xs)" }}>
                このセットは、サムネイル(0.jpg)・サンプル画像(選んだ枚数。右のつまみで順番を入れ替えられます)・Booth の告知タイル(サンプル以外からランダムな9枚を3×3に並べたもの)からなります。
              </p>
              <Button size="lg" onClick={() => void makePixiv()} disabled={!!pixivJob?.running}>
                <Sparkles /> {setFiles.length > 0 ? "作り直す" : validPicks.length > 0 ? `選んだ${validPicks.length}枚でセットを作る` : "ランダムにセットを作る"}
              </Button>
            </section>
            {pixivJob && <JobPanel key={pixivJob.id} jobId={pixivJob.id} label="Pixiv用セット" onFinished={(ok) => { refresh(); if (ok) toast.success("Pixiv用セットを作りました"); setPixivJob((j) => (j ? { ...j, running: false } : j)); }} />}
          </div>

          <div className="stack">
            {pixiv.length === 0 ? (
              <section className="panel panel-body">
                <p className="label">まだセットがありません。</p>
              </section>
            ) : (
              <section className="panel panel-body" aria-label="Pixivアップロード用ファイル">
                <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>アップロード用ファイル <span className="measured">{pixiv.length}</span></h3>
                <CopyField key={`b${boothLine(work, totalImages)}`} label="Booth に追記するテキスト" text={boothLine(work, totalImages)} />
                <CopyField key={`c${pixivCaption(work, totalImages)}`} label="Pixiv のキャプション" text={pixivCaption(work, totalImages)} rows={3} />
                <Button size="lg" onClick={() => void downloadAll(pixiv)} disabled={downloading}>
                  <Download /> {downloading ? "保存しています…" : `${pixiv.length}枚を個別にまとめて保存`}
                </Button>
                <Button asChild variant="outline">
                  <a href={`/api/release/zip?month=${month}&top=${encodeURIComponent(work)}`} download>
                    <Package /> ZIPでダウンロード
                  </a>
                </Button>
                <p className="label" style={{ fontSize: "var(--text-xs)" }}>
                  ブラウザから「複数のファイルのダウンロード」の許可を聞かれたら、許可してください。
                </p>
                {booth && (
                  <div style={{ display: "grid", gap: "var(--space-xs)" }}>
                    <span className="label">告知タイル</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl("out", month, booth.path, "&w=700")} alt="Booth 告知タイル画像" style={{ width: "100%", maxWidth: 420, border: "var(--rule-hair) solid var(--color-rule)", borderRadius: "var(--radius-pill)" }} />
                  </div>
                )}
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {pixiv.map((o) => (
                    <li key={o.path} className="row" style={{ padding: "var(--space-xs) 0" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl("out", month, o.path, "&w=120")} alt="" style={{ width: 44, height: 58, objectFit: "contain", background: "var(--color-paper-3)", borderRadius: 4 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="measured" style={{ display: "block", overflowWrap: "anywhere" }}>{o.name}</span>
                        <span className="label">{mb(o.size)}</span>
                      </span>
                      <Button asChild variant="outline" size="icon" aria-label={`${o.name}を保存`}>
                        <a href={fileUrl("out", month, o.path, `&download=1&name=${encodeURIComponent(saveNames.get(o.name) ?? o.name)}`)} download={saveNames.get(o.name) ?? o.name}>
                          <Download />
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      {tab === "files" && (
        <div className="cols">
          <div className="stack">
            <section className="panel panel-body">
              <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>PDF・ZIPを作る</h3>
              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                <button type="button" className="chip" aria-pressed={wantPdf} onClick={() => setWantPdf(!wantPdf)} style={{ minHeight: 44 }}>
                  <FileText size={16} aria-hidden style={{ marginRight: 6 }} /> PDF(グループごと)
                </button>
                <button type="button" className="chip" aria-pressed={wantZip} onClick={() => setWantZip(!wantZip)} style={{ minHeight: 44 }}>
                  <FileArchive size={16} aria-hidden style={{ marginRight: 6 }} /> ZIP(元の画像ごと)
                </button>
                <button type="button" className="chip" aria-pressed={force} onClick={() => setForce(!force)} style={{ minHeight: 44 }}>
                  あるものも作り直す
                </button>
              </div>
              <p className="label" style={{ fontSize: "var(--text-xs)" }}>
                PDFは長辺1920px・JPEG品質70に縮小して、グループごとに1つ(50MBを超えるときは自動で分割)。ZIPは元の画像をそのまま入れます。すでにあるPDFは、作り直す指定がなければ飛ばします。
              </p>
              <Button size="lg" onClick={() => void makeFiles()} disabled={!!buildJob?.running || (!wantPdf && !wantZip)}>
                作成する
              </Button>
            </section>
            {buildJob && <JobPanel key={buildJob.id} jobId={buildJob.id} label="PDF・ZIP" onFinished={(ok) => { refresh(); if (ok) toast.success("作成が終わりました"); setBuildJob((j) => (j ? { ...j, running: false } : j)); }} />}
          </div>
          <div className="stack">
            <section className="panel panel-body" aria-label="作成済み">
              <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>作成済み <span className="measured">{docs.length}</span></h3>
              {docs.length === 0 ? (
                <p className="label">まだありません。</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {docs.map((o) => (
                    <li key={o.path} className="row" style={{ padding: "var(--space-xs) 0" }}>
                      {o.kind === "pdf" ? <FileText size={20} aria-hidden /> : <FileArchive size={20} aria-hidden />}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="measured" style={{ display: "block", overflowWrap: "anywhere" }}>{o.name}</span>
                        <span className="label">{mb(o.size)}</span>
                      </span>
                      <Button asChild variant="outline" size="icon" aria-label={`${o.name}を保存`}>
                        <a href={fileUrl("out", month, o.path, "&download=1")} download={o.name}>
                          <Download />
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {cropping && (
        <ThumbCrop
          month={month}
          work={work}
          sources={(validPicks.length > 0 ? validPicks.map((k) => flat.find((x) => x.key === k)!) : flat).map((f) => ({ key: f.key, url: fileUrl("work", month, f.path, "&w=1600"), label: f.key }))}
          onClose={() => setCropping(false)}
          onSaved={refresh}
        />
      )}
      {viewer != null && <Viewer images={viewerImages} start={viewer} srcOf={(img) => fileUrl("work", month, img.path, "&w=1600")} onClose={() => setViewer(null)} />}
    </div>
  );
}
