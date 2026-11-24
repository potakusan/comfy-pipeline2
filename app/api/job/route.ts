import { NextRequest, NextResponse } from "next/server";
import { getMemJob } from "@/lib/server/jobs-memory";

export const dynamic = "force-dynamic";

/** GET /api/job?id=…  モザイク・PDF作成など、時間のかかる処理の進捗 */
export async function GET(req: NextRequest) {
  const job = getMemJob(req.nextUrl.searchParams.get("id") ?? "");
  if (!job) return NextResponse.json({ error: "ジョブが見つかりません(サーバーを再起動すると消えます)" }, { status: 404 });
  return NextResponse.json({ ...job, log: job.log.slice(-40) });
}
