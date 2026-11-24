"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { usePoll } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { TABS, isCurrent } from "./tab-bar";

interface QueueLite {
  held: { count: number }[];
  running: unknown[];
  pending: unknown[];
}

/** 全画面の上部: 画面名と、ComfyUI のキューの今(保留/実行中/待ち)、スマホでは「状態・設定」のメニュー。 */
export function AppBar() {
  const pathname = usePathname();
  const title = TABS.find((t) => isCurrent(t.href, pathname))?.label ?? "ComfyPipeline";
  const { data, error } = usePoll<QueueLite>("/api/queue", 5000);
  const [menu, setMenu] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-row">
        <h1 style={{ fontSize: "var(--text-xl)", maxWidth: "none" }}>{title}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
          <Link href="/queue" className="measured" style={{ textDecoration: "none", color: "var(--color-cool)" }} aria-label="キューの状況">
            {error ? (
              <span style={{ color: "var(--color-bad)" }}>未接続</span>
            ) : data ? (
              <span>
                {data.held.length > 0 && <span style={{ color: "var(--color-accent)" }}>保留 {data.held.reduce((n, h) => n + h.count, 0)} / </span>}
                実行 {data.running.length} / 待ち {data.pending.length}
              </span>
            ) : (
              <span style={{ color: "var(--color-muted)" }}>確認中</span>
            )}
          </Link>
          <Drawer open={menu} onOpenChange={setMenu}>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="メニュー(状態・設定)" className="appbar-menu">
                <Menu />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>メニュー</DrawerTitle>
              </DrawerHeader>
              <ul style={{ listStyle: "none", margin: 0, padding: "0 0 calc(var(--space-md) + var(--safe-bottom))" }}>
                {TABS.filter((t) => "more" in t).map((t) => {
                  const Icon = t.icon;
                  return (
                    <li key={t.href}>
                      <Link href={t.href} className="row" style={{ textDecoration: "none", minHeight: 56, borderTop: "var(--rule-hair) solid var(--color-rule)" }} onClick={() => setMenu(false)}>
                        <Icon size={20} aria-hidden style={{ color: "var(--color-muted)" }} />
                        {t.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
