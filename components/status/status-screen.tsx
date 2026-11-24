"use client";

import { Eraser } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Stats {
  vramTotal: number;
  vramFree: number;
  ramTotal: number;
  ramFree: number;
  gpuName: string;
  comfyVersion: string;
}

const GB = 1024 ** 3;
const gb = (n: number) => (n / GB).toFixed(1);

function Gauge({ label, total, free }: { label: string; total: number; free: number }) {
  const used = Math.max(total - free, 0);
  const ratio = total > 0 ? used / total : 0;
  return (
    <section className="panel panel-body" aria-label={label}>
      <span className="label">{label}</span>
      <div className="reading">
        {gb(used)}
        <span className="label" style={{ marginLeft: 8, fontFamily: "var(--font-outlier)" }}>
          / {gb(total)} GB
        </span>
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={`${label}の使用率`}>
        <i style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </section>
  );
}

export function StatusScreen() {
  const { data, error, loading, reload } = usePoll<Stats>("/api/stats", 4000);

  async function free() {
    try {
      await api("/api/stats", "POST");
      toast.success("モデルをメモリから解放しました");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解放に失敗しました");
    }
  }

  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>PC の状態を取得できません</h2>
          <p className="label">{error}</p>
          <p className="label">Tailscale が両方の端末でつながっているか、PC で ComfyUI が起動しているかを確認してください。</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Gauge label="VRAM" total={data.vramTotal} free={data.vramFree} />
      <Gauge label="メモリ" total={data.ramTotal} free={data.ramFree} />
      <section className="seams" aria-label="環境">
        <div className="row">
          <span className="label" style={{ width: "5.5em" }}>GPU</span>
          <span className="measured" style={{ overflowWrap: "anywhere" }}>{data.gpuName || "不明"}</span>
        </div>
        <div className="row">
          <span className="label" style={{ width: "5.5em" }}>ComfyUI</span>
          <span className="measured">{data.comfyVersion || "不明"}</span>
        </div>
      </section>
      <Button variant="outline" size="lg" onClick={() => void free()}>
        <Eraser /> モデルをメモリから解放
      </Button>
    </div>
  );
}
