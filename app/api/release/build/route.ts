import { NextRequest, NextResponse } from "next/server";
import { startBuild } from "@/lib/server/release";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { month, top, pdf, zip, force }  PDF・ZIP を作る。進捗は GET /api/job?id= */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { month?: string; top?: string; pdf?: boolean; zip?: boolean; force?: boolean };
    return NextResponse.json(startBuild({ month: b.month ?? "", top: b.top ?? "", pdf: b.pdf !== false, zip: b.zip !== false, force: !!b.force }));
  } catch (e) {
    return fail(e);
  }
}
