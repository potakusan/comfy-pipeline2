import { NextResponse } from "next/server";
import { ComfyError } from "./comfy";

/** 操作の誤りなど、画面にそのまま出せる理由つきのエラー(400)。想定外の失敗(500)と区別する。 */
export class UserError extends Error {}

/** ルートハンドラ共通のエラー整形。画面にそのまま出せる日本語メッセージを返す。 */
export function fail(e: unknown): NextResponse {
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ComfyError) return NextResponse.json({ error: e.message }, { status: e.status });
  const message = e instanceof Error ? e.message : "不明なエラー";
  return NextResponse.json({ error: message }, { status: 500 });
}
