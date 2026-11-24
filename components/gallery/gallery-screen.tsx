"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePoll } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderView } from "./folder-view";
import { DeleteFolderButton } from "./delete-folder-button";

interface Folder {
  name: string;
  count: number;
  firstImage: string | null;
  releaseCount: number;
}
/** フォルダ一覧 → 画像グリッド。開いているフォルダは URL(?folder=)に持つので、戻る操作・再読み込みで保たれる。 */
export function GalleryScreen() {
  const folder = useSearchParams().get("folder");
  return folder ? <FolderView folder={folder} /> : <FolderList />;
}

function FolderList() {
  const { data, error, loading, reload } = usePoll<{ dirs: Folder[] }>("/api/gallery/folders", null);

  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>ギャラリーを読み込めません</h2>
          <p className="label">{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }
  if (data.dirs.length === 0) {
    return (
      <div className="page">
        <div className="panel panel-body">
          <h2>まだ画像がありません</h2>
          <p className="label">「生成」タブから量産すると、日付とLoRA名のフォルダがここに並びます。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {[
        { key: "todo", title: "リリース未選択", list: data.dirs.filter((d) => d.releaseCount === 0) },
        { key: "done", title: "リリース選択あり", list: data.dirs.filter((d) => d.releaseCount > 0) },
      ]
        .filter((g) => g.list.length > 0)
        .map(({ key, title, list }) => (
          <section key={key} aria-label={title} style={{ display: "grid", gap: "var(--space-sm)" }}>
            <h2 className="label" style={{ fontSize: "var(--text-sm)", maxWidth: "none" }}>
              {title} <span className="measured">{list.length}</span>
            </h2>
            <ul className="cardgrid">
        {list.map((d) => (
          <li key={d.name} style={{ position: "relative" }}>
            <Link href={`/gallery?folder=${encodeURIComponent(d.name)}`} className="card">
              <span className="card-thumb">
                {d.firstImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/gallery/thumb?path=${encodeURIComponent(d.firstImage)}`} alt="" loading="lazy" />
                )}
              </span>
              <span className="card-body">
                <span className="card-title">{d.name}</span>
                <span className="measured" style={{ color: "var(--color-muted)" }}>
                  {d.count}枚{d.releaseCount > 0 ? ` ／ リリース ${d.releaseCount}` : ""}
                </span>
              </span>
            </Link>
            <DeleteFolderButton name={d.name} variant="card" summary={`${d.count}枚${d.releaseCount > 0 ? "とリリース分" : ""}`} onDone={() => void reload()} />
          </li>
        ))}
      </ul>
          </section>
        ))}
    </div>
  );
}
