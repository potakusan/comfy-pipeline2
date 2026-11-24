import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Host_Grotesk } from "next/font/google";
import { AppBar } from "@/components/shell/app-bar";
import { TabBar } from "@/components/shell/tab-bar";
import { PwaRegister } from "@/components/shell/pwa";
import { UpdateNotice } from "@/components/shell/update-notice";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const host = Host_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-host", display: "swap" });
const atkinson = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ComfyPipeline",
  description: "ComfyUI の量産・吟味を、スマホから。",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "ComfyPipeline", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1013",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`dark ${host.variable} ${atkinson.variable}`}>
      <body>
        <div className="shell">
          <AppBar />
          <main>{children}</main>
        </div>
        <TabBar />
        <Toaster position="top-center" />
        <PwaRegister />
        <UpdateNotice />
      </body>
    </html>
  );
}
