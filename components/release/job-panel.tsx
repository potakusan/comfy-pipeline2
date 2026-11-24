"use client";

import { useEffect, useRef, useState } from "react";
import { usePoll } from "@/lib/client/use-poll";
import type { MemJobState } from "@/lib/client/types";

/** 時間のかかる処理(PDF・ZIP・Pixiv用セット)の進捗。終わると onFinished を1回だけ呼ぶ。 */
export function JobPanel({ jobId, label, onFinished }: { jobId: string; label: string; onFinished: (ok: boolean) => void }) {
  const { data: job } = usePoll<MemJobState>(`/api/job?id=${jobId}`, 1200);
  const [showLog, setShowLog] = useState(false);
  const notified = useRef(false);
  const finished = job?.status === "completed" || job?.status === "failed";

  useEffect(() => {
    if (finished && !notified.current) {
      notified.current = true;
      onFinished(job?.status === "completed");
    }
  }, [finished, job?.status, onFinished]);

  return (
    <section className="panel panel-body" aria-live="polite" aria-label={label}>
      <span className="label">
        {label}: {job?.status === "failed" ? "失敗しました" : finished ? "完了しました" : "作成中…"}
      </span>
      {!finished && (
        <div className="bar" role="progressbar" aria-label="進捗" aria-valuemin={0} aria-valuemax={job?.total || 1} aria-valuenow={job?.current ?? 0}>
          <i style={{ transform: `scaleX(${job && job.total > 0 ? Math.min(1, job.current / job.total) : 0.05})` }} />
        </div>
      )}
      {job?.error && <p role="alert" style={{ color: "var(--color-bad)" }}>{job.error}</p>}
      <button type="button" className="chip" aria-pressed={showLog} onClick={() => setShowLog(!showLog)} style={{ justifySelf: "start" }}>
        ログ
      </button>
      {showLog && (
        <pre className="measured" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "30dvh", overflowY: "auto", margin: 0, padding: "var(--space-sm)", background: "var(--color-paper-3)", borderRadius: "var(--radius-pill)" }}>
          {(job?.log ?? []).join("\n")}
        </pre>
      )}
    </section>
  );
}
