import { NextResponse } from "next/server";
import { getPreview } from "@/lib/server/ws";

export const dynamic = "force-dynamic";

/** 生成中の途中画像(ComfyUI のライブプレビュー)。無いときは 204。 */
export async function GET() {
  const p = getPreview();
  if (!p) return new NextResponse(null, { status: 204 });
  return new NextResponse(new Uint8Array(p.data), {
    headers: { "Content-Type": p.mime, "Cache-Control": "no-store" },
  });
}
