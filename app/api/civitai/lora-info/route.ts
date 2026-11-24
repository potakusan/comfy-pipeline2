import { NextRequest, NextResponse } from "next/server";
import { loraCivitaiInfo } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/civitai/lora-info?name=<LoRA名>  手元の LoRA に紐づく Civitai の情報(タグ・サムネ・説明文) */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await loraCivitaiInfo(req.nextUrl.searchParams.get("name") ?? ""));
  } catch (e) {
    return fail(e);
  }
}
