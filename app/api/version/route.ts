import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 動いているアプリのビルドの印。開いたままの画面が、古い版のまま使われていないかを確かめるために使う。 */
const id = (() => {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "dev"; // 開発サーバーは保存のたびに画面が自動で更新される
  }
})();

export async function GET() {
  return NextResponse.json({ id });
}
