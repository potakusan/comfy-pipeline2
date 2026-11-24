import { NextRequest, NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/server/store";
import { listNodeOptions } from "@/lib/server/comfy";
import { fail } from "@/lib/server/http";
import type { GenerationSettings } from "@/lib/comfy/comfy-types";

export const dynamic = "force-dynamic";

const EDITABLE: (keyof GenerationSettings)[] = [
  "checkpoint",
  "upscaleModel",
  "upscaleSteps",
  "steps",
  "cfg",
  "sampler",
  "scheduler",
  "width",
  "height",
];

/** 現在の生成設定と、ComfyUI が持つ選択肢(モデル・サンプラー)。選択肢は取れなくても設定自体は返す。 */
export async function GET() {
  const settings = readSettings();
  const options = { checkpoints: [] as string[], upscalers: [] as string[], samplers: [] as string[], schedulers: [] as string[] };
  let warning: string | undefined;
  try {
    [options.checkpoints, options.upscalers, options.samplers, options.schedulers] = await Promise.all([
      listNodeOptions("CheckpointLoaderSimple", "ckpt_name"),
      listNodeOptions("UpscaleModelLoader", "model_name"),
      listNodeOptions("KSampler", "sampler_name"),
      listNodeOptions("KSampler", "scheduler"),
    ]);
  } catch (e) {
    warning = e instanceof Error ? e.message : "選択肢を取得できませんでした";
  }
  return NextResponse.json({ settings, options, warning });
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<GenerationSettings>;
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) if (key in body) patch[key] = body[key];
    return NextResponse.json({ settings: writeSettings(patch as Partial<GenerationSettings>) });
  } catch (e) {
    return fail(e);
  }
}
