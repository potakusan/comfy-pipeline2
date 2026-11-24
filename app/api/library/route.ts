import { NextResponse } from "next/server";
import { readLibrary } from "@/lib/server/library";
import { fail } from "@/lib/server/http";
import { readSettings } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** 画面の選択肢。プロンプト全文は送らず、id・名前・種別だけに絞って軽くする(全文は編集時に取得)。 */
export async function GET() {
  try {
    const lib = readLibrary();
    const slim = (list: typeof lib.pose) =>
      list.map((p) => ({ id: p.id, name: p.name, category: p.category ?? null, random: p.promptMode === "random" }));
    const nameOf = (list: typeof lib.pose, id?: string | null) => list.find((p) => p.id === id)?.name ?? null;
    const { width, height } = readSettings();
    return NextResponse.json({
      defaultSize: { width, height },
      loras: lib.variableLoras
        .filter((l) => !l.isArchived)
        .map((l) => ({ name: l.name, promptOnly: !!l.isPromptOnly })),
      fixedTags: lib.fixedTags,
      fixedLoras: lib.fixedLoras.map((l) => ({ name: l.name })),
      physical: slim(lib.physical),
      count: slim(lib.count),
      pose: slim(lib.pose),
      scene: slim(lib.scene),
      other: slim(lib.other),
      categories: lib.categories,
      variableDefs: Object.values(lib.variableDefs),
      sets: lib.batchSets.map((s) => ({
        id: s.id,
        name: s.name,
        presets: s.presets.map((p) => ({
          id: p.id,
          name: p.name,
          batchCount: p.batchCount,
          count: nameOf(lib.count, p.countPresetId),
          pose: nameOf(lib.pose, p.posePresetId),
          scene: nameOf(lib.scene, p.scenePresetId),
        })),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
