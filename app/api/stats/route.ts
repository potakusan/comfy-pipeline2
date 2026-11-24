import { NextResponse } from "next/server";
import { freeMemory, getSystemStats } from "@/lib/server/comfy";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSystemStats());
  } catch (e) {
    return fail(e);
  }
}

/** VRAM/RAM に載っているモデルを解放する */
export async function POST() {
  try {
    await freeMemory();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
