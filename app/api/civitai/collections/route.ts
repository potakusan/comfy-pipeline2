import { NextResponse } from "next/server";
import { listCollections } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET  フォロー済み・自分のコレクション(モデル) */
export async function GET() {
  try {
    return NextResponse.json({ collections: await listCollections() });
  } catch (e) {
    return fail(e);
  }
}
