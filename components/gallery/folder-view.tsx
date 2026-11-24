"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ChevronLeft, ListTree, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import { getPoseGroup } from "@/lib/comfy/group";
import { useLongPress } from "@/lib/client/use-long-press";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { MoreSheet } from "./more-sheet";
import { ResetReleaseButton } from "@/components/mosaic/reset-button";
import { DeleteFolderButton } from "./delete-folder-button";
import { Viewer, type ViewerImage } from "./viewer";

interface Img {
  /** 中身のバージョン。URL に付けて、名前の入れ替えのあとも古い画像を表示しない */
  v: string;
  path: string;
  filename: string;
  released: boolean;
  positivePrompt: string | null;
  negativePrompt: string | null;
  loraName: string | null;
  seed: number | null;
  canRegenerate: boolean;
  revisionOf: string | null;
}

interface Group {
  id: string;
  name: string;
  images: Img[];
  released: number;
}

const THUMB_KEY = "cp2_gallery_thumb";
const GROUP_KEY = "cp2_gallery_group";
const THUMB_MIN = 90;
const THUMB_MAX = 420;
/** 既定はスマホで1行2枚になる大きさ(列数はこの幅を下限に自動で決まる) */
const THUMB_DEFAULT = 160;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** タップ = リリース選択の切り替え(量産を吟味するとき、いちばん多い操作)、長押し = ビューアで開く */
/** ファイル名の連番部分(例: …_00012_.jpg → 00012)。見つからなければファイル名のまま */
const numberOf = (filename: string) => /_(\d{4,})_?(?:_rev_\d+)*\.[^.]+$/.exec(filename)?.[1] ?? filename;

function GalleryThumb({ img, onOpen, onToggle, swapOrder, dim }: { img: Img; onOpen: () => void; onToggle: () => void; swapOrder?: number; dim?: boolean }) {
  const press = useLongPress(onOpen, onToggle);
  const swapping = swapOrder !== undefined;
  return (
    <button
      type="button"
      {...press}
      className="gthumb"
      data-released={swapping ? swapOrder > 0 : img.released}
      data-dim={dim ? "true" : undefined}
      aria-label={`${img.filename}: ${swapping ? "タップで入れ替える画像に選ぶ" : "タップでリリース選択を切り替え"}、長押しで拡大表示`}
      aria-pressed={swapping ? swapOrder > 0 : img.released}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/gallery/thumb?path=${encodeURIComponent(img.path)}&v=${img.v}`} alt="" loading="lazy" draggable={false} />
      {swapping && swapOrder > 0 ? (
        <span className="gthumb-badge" aria-label={`入れ替え ${swapOrder}枚目`}>
          <ArrowLeftRight size={14} aria-hidden /> {swapOrder}
        </span>
      ) : (
        img.released && (
          <span className="gthumb-badge">
            <Star size={14} fill="currentColor" aria-hidden /> リリース
          </span>
        )
      )}
      {img.revisionOf && <span className="gthumb-rev">REV</span>}
    </button>
  );
}

/** グループ(プリセット)の一覧。選択済み/全枚数を並べ、押すとその位置へ移動する。 */
function GroupIndex({ groups, active, onJump, onMore }: { groups: Group[]; active: string | null; onJump: (id: string) => void; onMore: (g: Group) => void }) {
  return (
    <ul className="gindex" aria-label="プリセット一覧">
      {groups.map((g) => (
        <li key={g.id}>
          <button type="button" className="gindex-item" aria-current={g.id === active ? "true" : undefined} onClick={() => onJump(g.id)}>
            <span className="gindex-name">{g.name}</span>
            <span className="measured" data-has={g.released > 0}>
              {g.released}/{g.images.length}
            </span>
          </button>
          <button type="button" className="gindex-more" aria-label={`${g.name}をあと何枚か生成`} title="このプリセットをあと何枚か生成" onClick={() => onMore(g)}>
            <Plus size={18} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 画像グリッド。既定ではプリセット名単位にグループ分けし、v1 と同じく選択済み/全枚数とジャンプを持つ。 */
export function FolderView({ folder }: { folder: string }) {
  const { data, error, loading, reload } = usePoll<{ images: Img[] }>(`/api/gallery/images?folder=${encodeURIComponent(folder)}`, null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [onlyReleased, setOnlyReleased] = useState(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  // 長押し直後に一覧の再取得を待たず、見た目を先に切り替える
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [thumb, setThumb] = useState(THUMB_DEFAULT);
  const [grouped, setGrouped] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [more, setMore] = useState<string | null>(null);
  // 入れ替えモード: 同じプリセットの2枚を選んで、ファイル名(連番)を入れ替える
  const [swapMode, setSwapMode] = useState(false);
  const [swapSel, setSwapSel] = useState<string[]>([]);
  const [swapping, setSwapping] = useState(false);
  const router = useRouter();
  const headers = useRef(new Map<string, HTMLElement>());
  const controlsRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(150);

  // 前回の設定(サイズ・グループ分け)を復元する。保存先(localStorage)が使えなくても既定値で動く。
  useEffect(() => {
    setThumb(Math.min(THUMB_MAX, Math.max(THUMB_MIN, load(THUMB_KEY, THUMB_DEFAULT))));
    setGrouped(load(GROUP_KEY, true));
  }, []);

  const all = useMemo(() => (data?.images ?? []).map((i) => ({ ...i, released: override[i.path] ?? i.released })), [data, override]);

  // プリセット名単位に分ける。リリース選択の数え上げは絞り込みに関係なく全体で行う。
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const img of all) {
      const name = getPoseGroup(img.filename);
      const g = map.get(name) ?? { id: `g${map.size}`, name, images: [], released: 0 };
      g.images.push(img);
      if (img.released) g.released++;
      map.set(name, g);
    }
    return [...map.values()];
  }, [all]);

  const visibleGroups = useMemo(
    () => (grouped ? groups : [{ id: "all", name: "", images: all, released: all.filter((i) => i.released).length }]).map((g) => ({ ...g, images: onlyReleased ? g.images.filter((i) => i.released) : g.images })).filter((g) => g.images.length > 0),
    [grouped, groups, all, onlyReleased],
  );
  // ビューアの前後移動と一致するよう、画面に出ている並びのまま平らにする
  const ordered = useMemo(() => visibleGroups.flatMap((g) => g.images), [visibleGroups]);
  const indexOf = useMemo(() => new Map(ordered.map((img, i) => [img.path, i])), [ordered]);

  const viewerImages: ViewerImage[] = ordered.map((i) => ({
    path: i.path,
    v: i.v,
    caption: i.filename,
    released: i.released,
    canRegenerate: i.canRegenerate,
    info: { prompt: i.positivePrompt, negative: i.negativePrompt, lora: i.loraName, seed: i.seed },
  }));

  const jump = useCallback((id: string) => {
    setIndexOpen(false);
    // ドロワーが閉じて画面が戻ってから動かす
    setTimeout(() => headers.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }, []);

  // 上に固定される「アプリ上部バー + 操作列」の実際の高さを測り、ジャンプ位置と一覧の固定位置に使う
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const bar = document.querySelector<HTMLElement>(".topbar")?.offsetHeight ?? 53;
      const controls = controlsRef.current?.offsetHeight ?? 96;
      offsetRef.current = bar + controls;
      root.style.setProperty("--topbar-h", `${bar}px`);
      root.style.setProperty("--gal-offset", `${bar + controls}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (controlsRef.current) ro.observe(controlsRef.current);
    const bar = document.querySelector(".topbar");
    if (bar) ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // いま見えているグループを、右の一覧で強調する
  useEffect(() => {
    if (!grouped) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = offsetRef.current + 12; // 固定の操作列の少し下
      let current: string | null = null;
      for (const [id, el] of headers.current) if (el.getBoundingClientRect().top <= line) current = id;
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [grouped, visibleGroups]);

  async function setRelease(path: string, released: boolean) {
    setOverride((o) => ({ ...o, [path]: released }));
    try {
      await api("/api/gallery/release", released ? "POST" : "DELETE", { path });
      toast.success(released ? "リリースに選びました" : "リリース選択を外しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新に失敗しました");
    }
    await reload();
    setOverride((o) => {
      const { [path]: _drop, ...rest } = o;
      void _drop;
      return rest;
    });
  }

  async function remove(img: ViewerImage) {
    try {
      await api("/api/gallery/delete", "DELETE", { path: img.path });
      toast.success("削除しました");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除に失敗しました");
    }
  }

  async function regenerated(newPath: string) {
    await reload();
    setFocusPath(newPath);
  }

  // フォルダ一覧へ戻る。通常はクライアント遷移だが、通信の都合などで遷移が成立しなかったときに
  // 画面が動かないままにならないよう、少し待って URL が変わっていなければ通常のページ移動に切り替える。
  function backToList(e: React.MouseEvent) {
    e.preventDefault();
    router.push("/gallery");
    setTimeout(() => {
      if (new URLSearchParams(window.location.search).has("folder")) window.location.assign("/gallery");
    }, 700);
  }

  const refresh = useCallback(() => void reload(), [reload]);

  function pickForSwap(filename: string) {
    setSwapSel((sel) => {
      if (sel.includes(filename)) return sel.filter((f) => f !== filename);
      if (sel.length === 1 && getPoseGroup(sel[0]) !== getPoseGroup(filename)) {
        toast.warning("入れ替えられるのは、同じプリセットの中の画像だけです");
        return sel;
      }
      return sel.length >= 2 ? [sel[1], filename] : [...sel, filename];
    });
  }

  async function doSwap() {
    const [a, b] = swapSel;
    if (!a || !b) return;
    // 確認ダイアログ(window.confirm)は、ホーム画面のアプリなどで出ない・自動で閉じられることがあり、押しても何も起きないように見える。
    // 代わりに、下のバーに選んだ2枚を見せ、入れ替えたあとは「元に戻す」を出す(もう一度入れ替えるだけで元に戻る)。
    setSwapping(true);
    try {
      const r = await api<{ a: string; b: string }>("/api/gallery/swap", "POST", { folder, a, b });
      setSwapSel([]);
      await reload();
      toast.success(`入れ替えました: ${numberOf(a)} ⇄ ${numberOf(b)}`, {
        description: `${r.a} ⇄ ${r.b}`,
        duration: 15000,
        action: {
          label: "元に戻す",
          // 入れ替えたあとの名前の2枚を、もう一度入れ替える
          onClick: () =>
            void api("/api/gallery/swap", "POST", { folder, a: r.a, b: r.b })
              .then(() => {
                toast.success("元に戻しました");
                return reload();
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : "元に戻せませんでした")),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "入れ替えられませんでした", { duration: 15000 });
    } finally {
      setSwapping(false);
    }
  }
  const releasedTotal = all.filter((i) => i.released).length;
  const showIndex = grouped && groups.length > 0;

  return (
    <div className="page wide gallery-page">
      <h2 style={{ minWidth: 0, fontSize: "var(--text-lg)", maxWidth: "none", overflowWrap: "anywhere" }}>{folder}</h2>
      <p className="label" style={{ fontSize: "var(--text-xs)" }}>{swapMode ? "入れ替えモード: 同じプリセットの画像を2枚タップして選びます ／ 長押し: 拡大して見る" : "タップ: リリース選択の切り替え ／ 長押し: 拡大して見る"}</p>

      <div className="gallery-controls" ref={controlsRef}>
        <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center", flexWrap: "wrap" }}>
          {/* 上に固定される操作列に置く: 深くスクロールしていてもすぐ一覧へ戻れる */}
          <Link href="/gallery" onClick={backToList} className="chip gallery-back" aria-label="フォルダ一覧へ戻る">
            <ChevronLeft size={18} aria-hidden />
            <span>一覧</span>
          </Link>
          <button type="button" className="chip" aria-pressed={!onlyReleased} onClick={() => setOnlyReleased(false)}>
            すべて <span className="measured" style={{ marginLeft: 6 }}>{all.length}</span>
          </button>
          <button type="button" className="chip" aria-pressed={onlyReleased} onClick={() => setOnlyReleased(true)}>
            リリース選択 <span className="measured" style={{ marginLeft: 6 }}>{releasedTotal}</span>
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={grouped}
            onClick={() => {
              setGrouped(!grouped);
              save(GROUP_KEY, !grouped);
            }}
          >
            プリセット別
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={swapMode}
            onClick={() => {
              setSwapMode(!swapMode);
              setSwapSel([]);
            }}
          >
            <ArrowLeftRight size={16} aria-hidden style={{ marginRight: 6 }} />
            入れ替え
          </button>
          {releasedTotal > 0 && <ResetReleaseButton folder={folder} variant="chip" onDone={refresh} />}
          <DeleteFolderButton name={folder} variant="chip" summary={`${all.length}枚${releasedTotal > 0 ? "とリリース分" : ""}`} onDone={() => (window.location.href = "/gallery")} />
          {showIndex && (
            <Drawer open={indexOpen} onOpenChange={setIndexOpen}>
              <DrawerTrigger asChild>
                <button type="button" className="chip gindex-open" aria-label="プリセット一覧を開く">
                  <ListTree size={16} aria-hidden style={{ marginRight: 6 }} />
                  一覧
                </button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>プリセット別(選択済み/全枚数)</DrawerTitle>
                </DrawerHeader>
                <div style={{ overflowY: "auto", maxHeight: "60dvh", overscrollBehavior: "contain", paddingBottom: "var(--safe-bottom)" }}>
                  <GroupIndex groups={groups} active={active} onJump={jump} onMore={(g) => { setIndexOpen(false); setMore(g.name); }} />
                </div>
              </DrawerContent>
            </Drawer>
          )}
        </div>
        <div className="gallery-size">
          <span className="label" id="thumb-label">サイズ</span>
          <Slider
            aria-label="サムネイルの大きさ"
            aria-labelledby="thumb-label"
            min={THUMB_MIN}
            max={THUMB_MAX}
            step={10}
            value={[thumb]}
            onValueChange={([v]) => setThumb(v)}
            onValueCommit={([v]) => save(THUMB_KEY, v)}
          />
          <span className="measured" style={{ minWidth: "3.5em", textAlign: "right" }}>{thumb}px</span>
        </div>
      </div>

      {loading && <Skeleton className="h-64 w-full" />}
      {error && (
        <div className="panel panel-body" role="alert">
          <p>{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      )}
      {!loading && !error && ordered.length === 0 && (
        <div className="panel panel-body">
          <p className="label">{onlyReleased ? "リリースに選んだ画像はまだありません。" : "このフォルダに画像がありません。"}</p>
        </div>
      )}

      {ordered.length > 0 && (
        <div className="gallery-layout" data-index={showIndex}>
          <div className="gallery-main" style={{ ["--thumb" as string]: `${thumb}px` }}>
            {visibleGroups.map((g) => (
              <section key={g.id} className="ggroup" aria-label={g.name || "画像"}>
                {grouped && (
                  <h3
                    id={`group-${g.id}`}
                    className="ggroup-head"
                    ref={(el) => {
                      if (el) headers.current.set(g.id, el);
                      else headers.current.delete(g.id);
                    }}
                  >
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{g.name}</span>
                    <span className="measured" data-has={g.released > 0}>
                      {g.released}/{groups.find((x) => x.id === g.id)?.images.length ?? g.images.length}
                    </span>
                  </h3>
                )}
                <div className="gallery-grid">
                  {g.images.map((img) => (
                    <GalleryThumb
                      key={img.path}
                      img={img}
                      onOpen={() => setViewer(indexOf.get(img.path) ?? 0)}
                      onToggle={() => (swapMode ? pickForSwap(img.filename) : void setRelease(img.path, !img.released))}
                      swapOrder={swapMode ? swapSel.indexOf(img.filename) + 1 : undefined}
                      dim={swapMode && swapSel.length === 1 && getPoseGroup(img.filename) !== getPoseGroup(swapSel[0])}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {showIndex && (
            <aside className="gallery-index" aria-label="プリセット別の枚数">
              <p className="label" style={{ padding: "var(--space-xs) var(--space-sm)" }}>
                プリセット <span className="measured">{groups.length}</span>
              </p>
              <GroupIndex groups={groups} active={active} onJump={jump} onMore={(g) => setMore(g.name)} />
            </aside>
          )}
        </div>
      )}

      {swapMode && (
        <div className="action-bar" role="region" aria-label="入れ替え">
          <span className="label" style={{ flex: 1, minWidth: 0, alignSelf: "center", paddingInline: "var(--space-xs)" }}>
            {swapSel.length === 0
              ? "入れ替える画像を2枚選んでください"
              : swapSel.length === 1
                ? `「${numberOf(swapSel[0])}」と入れ替える、もう1枚(同じプリセット)を選んでください`
                : `「${numberOf(swapSel[0])}」と「${numberOf(swapSel[1])}」を入れ替えます`}
          </span>
          <Button variant="outline" size="lg" onClick={() => { setSwapMode(false); setSwapSel([]); }}>
            終了
          </Button>
          <Button size="lg" disabled={swapSel.length !== 2 || swapping} onClick={() => void doSwap()}>
            <ArrowLeftRight /> {swapping ? "入れ替え中…" : "入れ替える"}
          </Button>
        </div>
      )}

      {more && <MoreSheet folder={folder} group={more} onClose={() => setMore(null)} onImageSaved={refresh} />}

      {viewer != null && (
        <Viewer
          images={viewerImages}
          start={viewer}
          focusPath={focusPath}
          onClose={() => {
            setViewer(null);
            setFocusPath(null);
          }}
          onToggleRelease={async (img) => setRelease(img.path, !img.released)}
          onDelete={remove}
          onRegenerated={(p) => void regenerated(p)}
        />
      )}
    </div>
  );
}
