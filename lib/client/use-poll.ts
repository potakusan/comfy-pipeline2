"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * url を一定間隔で取得する。タブが裏に回っている間(スマホのロック中を含む)は止め、
 * 戻ってきたら即座に取り直す。interval を null にすると 1 回だけ取得する。
 */
export function usePoll<T>(url: string | null, interval: number | null = 3000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!alive.current) return;
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        setData(body as T);
        setError(null);
      }
    } catch {
      if (alive.current) setError("PC に接続できません。Tailscale が接続中か確認してください");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    // 初回取得と、以降の定期取得・復帰時の取得。state の更新は load 内の非同期完了後に行う。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (interval == null) return () => void (alive.current = false);
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = setInterval(tick, interval);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, interval]);

  return { data, error, loading, reload: load };
}

export async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}
