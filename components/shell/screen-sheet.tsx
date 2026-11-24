"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 下に固定する操作ボタン列(保存など) */
  footer?: React.ReactNode;
}

/**
 * 編集用の全画面シート。スマホではキーボードが出ても入力欄が隠れにくく、
 * タブレットでは中央の幅に収まる。ピッカー(ボトムシート)はこの上に重なる。
 */
export function ScreenSheet({ title, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-panel">
        <header className="sheet-head">
          <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "none" }}>{title}</h2>
          <Button variant="ghost" size="icon" aria-label="閉じる" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}
