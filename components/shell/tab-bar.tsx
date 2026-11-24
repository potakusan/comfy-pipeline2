"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Grid3X3, Images, ListOrdered, PackageCheck, Settings, Wand2 } from "lucide-react";

/**
 * 主な5つはスマホの下のバーにも並べる。「状態」「設定」は使う頻度が低いので、スマホでは
 * 上部バーのメニューにしまい(幅 900px 以上の左レールでは全部並ぶ)。
 */
export const TABS = [
  { href: "/", label: "生成", icon: Wand2 },
  { href: "/queue", label: "キュー", icon: ListOrdered },
  { href: "/gallery", label: "ギャラリー", icon: Images },
  { href: "/mosaic", label: "モザイク", icon: Grid3X3 },
  { href: "/release", label: "リリース", icon: PackageCheck },
  { href: "/status", label: "状態", icon: Activity, more: true },
  { href: "/settings", label: "設定", icon: Settings, more: true },
] as const;

export const isCurrent = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="メイン">
      {TABS.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="tab"
            data-more={"more" in t ? "true" : undefined}
            aria-current={isCurrent(t.href, pathname) ? "page" : undefined}
          >
            <Icon size={22} strokeWidth={1.75} aria-hidden />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
