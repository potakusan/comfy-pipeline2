"use client";

import { useCallback, useRef } from "react";

/**
 * 長押し(既定 450ms)と通常のタップを分ける。指が 10px 以上動いたらスクロールとみなして長押しを取り消す。
 * 長押しが成立したあとの click は無視する(離した瞬間にビューアが開かないように)。
 */
export function useLongPress(onLong: () => void, onTap: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        try {
          navigator.vibrate?.(30);
        } catch {}
        onLong();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // iOS/Android の長押しメニュー(画像の保存など)を出さない
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  };
}
