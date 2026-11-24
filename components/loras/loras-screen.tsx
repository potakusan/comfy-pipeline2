"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Download, ExternalLink, ListPlus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenSheet } from "@/components/shell/screen-sheet";
import { JobPanel } from "@/components/release/job-panel";
import { LoraAddSheet } from "@/components/generate/lora-add";

interface LocalLora {
  fileName: string;
  name: string;
  size: number;
  mtime: string;
  thumb: string | null;
  trainedWords: string[];
  civitaiModelId: number | null;
  baseModel: string | null;
  versionName: string | null;
}
interface ModelCard {
  id: number;
  name: string;
  creator: string | null;
  thumb: string | null;
  baseModels: string[];
  downloads: number | null;
  likes: number | null;
  installed: boolean;
}
interface CollectionCard {
  id: number;
  name: string;
  owner: string | null;
  isOwner: boolean;
  thumb: string | null;
}
interface VersionInfo {
  id: number;
  name: string;
  baseModel: string;
  trainedWords: string[];
  sizeKB: number | null;
  fileName: string | null;
  thumb: string | null;
  installed: boolean;
}
interface ModelDetail {
  id: number;
  name: string;
  creator: string | null;
  url: string;
  versions: VersionInfo[];
}

type Tab = "mine" | "search" | "collections";

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)}GB` : `${(n / 1024 ** 2).toFixed(0)}MB`);
const SORTS = [
  { id: "Most Downloaded", label: "人気" },
  { id: "Highest Rated", label: "高評価" },
  { id: "Newest", label: "新着" },
];
const PERIODS = [
  { id: "AllTime", label: "全期間" },
  { id: "Year", label: "1年" },
  { id: "Month", label: "1か月" },
  { id: "Week", label: "1週間" },
];

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast.success("コピーしました");
}

function Card({ thumb, thumbs, title, lines, badge, onClick }: { thumb: string | null; thumbs?: string[]; title: string; lines: string[]; badge?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="card" onClick={onClick} style={{ width: "100%", textAlign: "left", font: "inherit" }}>
        <span className="card-thumb">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : thumbs && thumbs.length > 0 ? (
            // 表紙がないコレクション: 中の LoRA のサムネイルを 2×2 で並べる
            <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2 }}>
              {thumbs.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: "static", width: "100%", height: "100%", objectFit: "cover", minWidth: 0, minHeight: 0 }} />
              ))}
            </span>
          ) : (
            <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "var(--text-xl)", color: "var(--color-muted)" }}>
              {Array.from(title)[0] ?? "?"}
            </span>
          )}
          {badge && (
            <span className="gthumb-badge" style={{ position: "absolute", top: 6, left: 6 }}>
              {badge}
            </span>
          )}
        </span>
        <span className="card-body">
          <span className="card-title">{title}</span>
          {lines.map((l) => (
            <span key={l} className="measured" style={{ color: "var(--color-muted)", overflowWrap: "anywhere" }}>
              {l}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}

export function LorasScreen() {
  const [tab, setTab] = useState<Tab>("mine");
  const [openModel, setOpenModel] = useState<number | null>(null);
  const local = usePoll<{ dir: string; items: LocalLora[] }>("/api/loras", null);

  return (
    <div className="page wide">
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }} role="tablist" aria-label="LoRA">
        {(
          [
            ["mine", `持っているLoRA${local.data ? ` (${local.data.items.length})` : ""}`],
            ["search", "Civitaiで探す"],
            ["collections", "コレクション"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="chip" data-on={tab === id} style={{ minHeight: 44 }} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "mine" && <MineTab state={local} onOpenCivitai={setOpenModel} />}
      {tab === "search" && <SearchTab onOpen={setOpenModel} />}
      {tab === "collections" && <CollectionsTab onOpen={setOpenModel} />}

      {openModel != null && <ModelSheet id={openModel} onClose={() => setOpenModel(null)} onInstalled={() => void local.reload()} />}
    </div>
  );
}

// ---- 持っているLoRA ------------------------------------------------------------------------

function MineTab({ state, onOpenCivitai }: { state: ReturnType<typeof usePoll<{ dir: string; items: LocalLora[] }>>; onOpenCivitai: (id: number) => void }) {
  const { data, error, loading, reload } = state;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LocalLora | null>(null);
  const items = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (data?.items ?? []).filter((l) => !k || `${l.name} ${l.fileName} ${l.trainedWords.join(" ")}`.toLowerCase().includes(k));
  }, [data, q]);

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error || !data)
    return (
      <div className="panel panel-body" role="alert">
        <h2>LoRA を読み込めません</h2>
        <p className="label">{error}</p>
        <Button onClick={() => void reload()}>再試行</Button>
      </div>
    );
  return (
    <>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・トリガーワードで絞り込み" aria-label="LoRA を絞り込み" />
      {items.length === 0 ? (
        <div className="panel panel-body">
          <p className="label">{data.items.length === 0 ? "LoRA がありません。「Civitaiで探す」から入れられます。" : "一致する LoRA がありません。"}</p>
        </div>
      ) : (
        <ul className="cardgrid">
          {items.map((l) => (
            <Card key={l.fileName} thumb={l.thumb} title={l.name} lines={[mb(l.size), l.trainedWords.slice(0, 2).join(", ")].filter(Boolean)} onClick={() => setOpen(l)} />
          ))}
        </ul>
      )}
      <p className="label" style={{ fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>保存先: {data.dir}</p>
      {open && (
        <LocalSheet
          lora={open}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null);
            void reload();
          }}
          onOpenCivitai={(id) => {
            setOpen(null);
            onOpenCivitai(id);
          }}
        />
      )}
    </>
  );
}

function Words({ words }: { words: string[] }) {
  if (words.length === 0) return <p className="label">トリガーワードはありません。</p>;
  return (
    <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
      {words.map((w) => (
        <button key={w} type="button" className="chip" onClick={() => void copyText(w)} title="タップでコピー" style={{ minHeight: 40, overflowWrap: "anywhere", textAlign: "left" }}>
          <Copy size={14} aria-hidden style={{ marginRight: 6, flex: "none" }} />
          {w}
        </button>
      ))}
    </div>
  );
}

function LocalSheet({ lora, onClose, onDeleted, onOpenCivitai }: { lora: LocalLora; onClose: () => void; onDeleted: () => void; onOpenCivitai: (id: number) => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const registry = usePoll<{ loras: { name: string }[] }>("/api/library", null);
  const listName = lora.fileName.replace(/\.(safetensors|ckpt|pt)$/i, "");
  const registered = registry.data?.loras.some((l) => l.name === listName) ?? false;
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  async function remove() {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await api("/api/loras", "DELETE", { fileName: lora.fileName });
      toast.success(`${lora.fileName} を削除しました`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <ScreenSheet
      title={lora.name}
      onClose={onClose}
      footer={
        <Button variant={armed ? "destructive" : "outline"} size="lg" disabled={busy} onClick={() => void remove()}>
          <Trash2 /> {armed ? "もう一度押すと削除(元に戻せません)" : "この LoRA を削除"}
        </Button>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-sm)" }}>
        {lora.thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lora.thumb} alt="" style={{ width: "100%", maxWidth: 320, borderRadius: "var(--radius-pill)", justifySelf: "center" }} />
        )}
        <p className="measured" style={{ overflowWrap: "anywhere" }}>
          {lora.fileName} ／ {mb(lora.size)}
          {lora.baseModel ? ` ／ ${lora.baseModel}` : ""}
          {lora.versionName ? ` ／ ${lora.versionName}` : ""}
        </p>
        <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>トリガーワード</h3>
        <Words words={lora.trainedWords} />
        {lora.trainedWords.length > 1 && (
          <Button variant="outline" onClick={() => void copyText(lora.trainedWords.join(", "))}>
            <Copy /> すべてコピー
          </Button>
        )}
        <Button size="lg" disabled={registered || !registry.data} onClick={() => setAdding(true)}>
          {registered ? <Check /> : <ListPlus />} {registered ? "生成画面のキャラクターに登録済み" : "生成画面のキャラクターに追加"}
        </Button>
        {lora.civitaiModelId && (
          <Button variant="outline" onClick={() => onOpenCivitai(lora.civitaiModelId!)}>
            <ExternalLink /> Civitai のページ情報を開く
          </Button>
        )}
      </div>
      {adding && <LoraAddSheet initial={{ name: listName, trainedWords: lora.trainedWords }} onClose={() => setAdding(false)} onAdded={() => void registry.reload()} />}
    </ScreenSheet>
  );
}

// ---- Civitai で探す ------------------------------------------------------------------------

function useCards(buildUrl: (cursor: string) => string | null) {
  const [items, setItems] = useState<ModelCard[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const run = useCallback(
    async (more: boolean, cursor: string | null) => {
      const url = buildUrl(more && cursor ? cursor : "");
      if (!url) return;
      setLoading(true);
      setError(null);
      try {
        const r = await api<{ items: ModelCard[]; nextCursor: string | null }>(url, "GET");
        setItems((prev) => (more ? [...prev, ...r.items.filter((n) => !prev.some((p) => p.id === n.id))] : r.items));
        setNext(r.nextCursor);
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "取得できませんでした");
      } finally {
        setLoading(false);
      }
    },
    [buildUrl],
  );
  return { items, next, loading, error, loaded, run };
}

function ModelGrid({ items, onOpen }: { items: ModelCard[]; onOpen: (id: number) => void }) {
  return (
    <ul className="cardgrid">
      {items.map((m) => (
        <Card
          key={m.id}
          thumb={m.thumb}
          title={m.name}
          badge={m.installed ? "導入済み" : undefined}
          lines={[m.creator ? `by ${m.creator}` : "", [m.downloads != null ? `DL ${m.downloads.toLocaleString()}` : "", m.likes != null ? `♥ ${m.likes.toLocaleString()}` : ""].filter(Boolean).join(" ／ ")].filter(Boolean)}
          onClick={() => onOpen(m.id)}
        />
      ))}
    </ul>
  );
}

function SearchTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("Most Downloaded");
  const [period, setPeriod] = useState("AllTime");
  const [applied, setApplied] = useState({ q: "", sort: "Most Downloaded", period: "AllTime" });
  const buildUrl = useCallback(
    (cursor: string) => `/api/civitai/search?q=${encodeURIComponent(applied.q)}&sort=${encodeURIComponent(applied.sort)}&period=${applied.period}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    [applied],
  );
  const { items, next, loading, error, loaded, run } = useCards(buildUrl);

  useEffect(() => {
    void run(false, null);
  }, [run]);

  const submit = () => setApplied({ q, sort, period });

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: "grid", gap: "var(--space-xs)" }}
      >
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="キャラ名・作品名など(英語が確実)" aria-label="検索" enterKeyHint="search" />
          <Button type="submit" size="lg" aria-label="検索">
            <Search />
          </Button>
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
          <span className="label">Illustrious の LoRA</span>
          {SORTS.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={sort === s.id} onClick={() => { setSort(s.id); setApplied({ q, sort: s.id, period }); }}>
              {s.label}
            </button>
          ))}
          {sort === "Most Downloaded" || sort === "Highest Rated"
            ? PERIODS.map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={period === p.id} onClick={() => { setPeriod(p.id); setApplied({ q, sort, period: p.id }); }}>
                  {p.label}
                </button>
              ))
            : null}
        </div>
      </form>
      {error && <p role="alert" style={{ color: "var(--color-bad)" }}>{error}</p>}
      {loaded && items.length === 0 && !loading && <p className="label">見つかりませんでした。</p>}
      <ModelGrid items={items} onOpen={onOpen} />
      {loading && <Skeleton className="h-24 w-full" />}
      {next && !loading && (
        <Button variant="outline" size="lg" onClick={() => void run(true, next)}>
          もっと見る
        </Button>
      )}
    </>
  );
}

/** コレクションのカード。表紙がなければ、中の LoRA のサムネイルを取りに行く。 */
function CollectionTile({ c, onOpen }: { c: CollectionCard; onOpen: () => void }) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    if (c.thumb) return;
    let alive = true;
    api<{ thumbs: string[] }>(`/api/civitai/collection-preview?id=${c.id}`, "GET")
      .then((r) => alive && setThumbs(r.thumbs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [c.id, c.thumb]);
  return <Card thumb={c.thumb} thumbs={thumbs} title={c.name} lines={c.owner && !c.isOwner ? [`by ${c.owner}`] : []} onClick={onOpen} />;
}

// ---- コレクション ------------------------------------------------------------------------

function CollectionsTab({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, error, loading, reload } = usePoll<{ collections: CollectionCard[] }>("/api/civitai/collections", null);
  const [open, setOpen] = useState<CollectionCard | null>(null);
  const [illustriousOnly, setIllustriousOnly] = useState(true);
  const [filter, setFilter] = useState("");

  const buildUrl = useCallback((cursor: string) => (open ? `/api/civitai/collection?id=${open.id}&illustrious=${illustriousOnly ? 1 : 0}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` : null), [open, illustriousOnly]);
  const { items, next, loading: loadingItems, error: itemsError, loaded, run } = useCards(buildUrl);
  useEffect(() => {
    if (open) void run(false, null);
  }, [open, run]);

  if (open) {
    return (
      <>
        <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="outline" onClick={() => setOpen(null)}>
            <ArrowLeft /> コレクション一覧
          </Button>
          <button type="button" className="chip" aria-pressed={illustriousOnly} onClick={() => setIllustriousOnly(!illustriousOnly)}>
            Illustrious のみ
          </button>
        </div>
        <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "none", overflowWrap: "anywhere" }}>{open.name}</h2>
        {itemsError && <p role="alert" style={{ color: "var(--color-bad)" }}>{itemsError}</p>}
        {loaded && items.length === 0 && !loadingItems && <p className="label">{illustriousOnly && next ? "このページに Illustrious の LoRA がありません。「もっと見る」で続きを探せます。" : "LoRA がありません。"}</p>}
        <ModelGrid items={items} onOpen={onOpen} />
        {loadingItems && <Skeleton className="h-24 w-full" />}
        {next && !loadingItems && (
          <Button variant="outline" size="lg" onClick={() => void run(true, next)}>
            もっと見る
          </Button>
        )}
      </>
    );
  }

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error || !data)
    return (
      <div className="panel panel-body" role="alert">
        <h2>コレクションを読み込めません</h2>
        <p className="label">{error}</p>
        <Button onClick={() => void reload()}>再試行</Button>
      </div>
    );
  const k = filter.trim().toLowerCase();
  const shown = data.collections.filter((c) => !k || c.name.toLowerCase().includes(k));
  const followed = shown.filter((c) => !c.isOwner);
  const mine = shown.filter((c) => c.isOwner);
  return (
    <>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="コレクション名で絞り込み" aria-label="コレクションを絞り込み" />
      {followed.length > 0 && <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>フォロー中 <span className="measured">{followed.length}</span></h3>}
      <ul className="cardgrid">
        {followed.map((c) => (
          <CollectionTile key={c.id} c={c} onOpen={() => setOpen(c)} />
        ))}
      </ul>
      {mine.length > 0 && <h3 style={{ fontSize: "var(--text-md)", maxWidth: "none" }}>自分のコレクション <span className="measured">{mine.length}</span></h3>}
      <ul className="cardgrid">
        {mine.map((c) => (
          <CollectionTile key={c.id} c={c} onOpen={() => setOpen(c)} />
        ))}
      </ul>
      {shown.length === 0 && <p className="label">コレクションがありません。</p>}
    </>
  );
}

// ---- モデル詳細・ダウンロード ---------------------------------------------------------------------

function ModelSheet({ id, onClose, onInstalled }: { id: number; onClose: () => void; onInstalled: () => void }) {
  const { data, error, loading, reload } = usePoll<ModelDetail>(`/api/civitai/model?id=${id}`, null);
  const [job, setJob] = useState<{ id: string; label: string } | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  async function download(v: VersionInfo) {
    setStarting(v.id);
    try {
      const r = await api<{ jobId: string }>("/api/civitai/download", "POST", { versionId: v.id });
      setJob({ id: r.jobId, label: `${data?.name ?? ""} ${v.name}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ダウンロードを始められませんでした");
    } finally {
      setStarting(null);
    }
  }

  return (
    <ScreenSheet title={data?.name ?? "LoRA"} onClose={onClose}>
      {loading && <Skeleton className="h-40 w-full" />}
      {error && <p role="alert" style={{ color: "var(--color-bad)" }}>{error}</p>}
      {data && (
        <div style={{ display: "grid", gap: "var(--space-sm)" }}>
          <p className="label">
            {data.creator ? `by ${data.creator} ／ ` : ""}
            <a href={data.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              Civitai で開く
            </a>
          </p>
          {job && (
            <JobPanel
              key={job.id}
              jobId={job.id}
              label={`ダウンロード: ${job.label}`}
              onFinished={(ok) => {
                if (ok) toast.success("LoRA を入れました(ComfyUI 側で更新すると選べます)");
                onInstalled();
                void reload();
              }}
            />
          )}
          {data.versions.map((v) => (
            <section key={v.id} className="panel panel-body" aria-label={v.name}>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                {v.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumb} alt="" referrerPolicy="no-referrer" style={{ width: 72, height: 96, objectFit: "contain", background: "var(--color-paper-3)", borderRadius: 4, flex: "none" }} />
                )}
                <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{v.name}</strong>
                  <span className="measured" style={{ color: v.baseModel.includes("Illustrious") ? "var(--color-ok)" : "var(--color-muted)" }}>
                    {v.baseModel || "不明"}
                    {v.sizeKB ? ` ／ ${mb(v.sizeKB * 1024)}` : ""}
                  </span>
                  {v.fileName && <span className="measured" style={{ color: "var(--color-muted)", overflowWrap: "anywhere" }}>{v.fileName}</span>}
                </div>
              </div>
              <Words words={v.trainedWords} />
              <Button size="lg" disabled={v.installed || starting === v.id || !!job} onClick={() => void download(v)}>
                {v.installed ? <Check /> : <Download />} {v.installed ? "導入済み" : "ダウンロードして入れる"}
              </Button>
            </section>
          ))}
        </div>
      )}
    </ScreenSheet>
  );
}
