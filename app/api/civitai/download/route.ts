import { NextRequest, NextResponse } from "next/server";
import { startLoraDownload } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { versionId }  LoRA をダウンロードして LoRA フォルダに置く。進捗は GET /api/job?id= */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { versionId?: number };
    return NextResponse.json(await startLoraDownload(Number(b.versionId)));
  } catch (e) {
    return fail(e);
  }
}
