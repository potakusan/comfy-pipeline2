import fs from "fs";
import { describe, expect, it } from "vitest";
import { templateFromMeta } from "./more";
import { renderItem } from "@/lib/comfy/item";
import type { ImageMetadata, Preset, V1Recipe } from "@/lib/comfy/comfy-types";

const settings = { checkpoint: "c", upscaleModel: "u", upscaleSteps: 0, width: 960, height: 1600, randomizeSeed: false, seed: 1, steps: 8, cfg: 3, sampler: "euler", scheduler: "karras", denoise: 1 };

const pose: Preset = { id: "p", name: "pose", type: "pose", prompt: "# コメント\nsitting\nstanding\nlying", promptMode: "random" };
const recipe: V1Recipe = {
  variableLora: null,
  fixedLoras: [],
  fixedTags: "masterpiece",
  negativePrompt: "bad",
  presets: { selectedPhysicals: [], selectedCount: null, selectedPose: pose, selectedScene: null, selectedOthers: [] },
  additionalPrompt: { mode: "random", lines: ["smile", "blush", "%%cloth%%"] },
  variationTags: ["from above", "from below"],
  variableDefs: { cloth: { name: "cloth", mode: "random", candidates: ["dress", "shirt"] } },
  variableInputValues: {},
};
const meta: ImageMetadata = { mode: "normal", loraName: "x", positivePrompt: "p", settings, queueLabel: "q", createdAt: 0, recipe };

describe("templateFromMeta", () => {
  it("v1 のレシピから、v2 の雛形を作る", () => {
    const t = templateFromMeta(meta, "グループ");
    expect(t?.label).toBe("グループ");
    expect(t?.presets.pose?.name).toBe("pose");
    expect(t?.additionalMode).toBe("random");
    expect(t?.settings.randomizeSeed).toBe(true);
  });

  it("ランダム部分は呼ぶたびに引き直され、コメント行は選ばれない", () => {
    const t = templateFromMeta(meta, "g")!;
    const prompts = new Set(Array.from({ length: 60 }, () => renderItem(t).positive));
    expect(prompts.size).toBeGreaterThan(5);
    for (const p of prompts) {
      expect(p).not.toContain("コメント");
      expect(p).not.toContain("%%");
    }
  });

  it("雛形(template)があれば、そちらを優先する", () => {
    const own = templateFromMeta(meta, "g")!;
    const t = templateFromMeta({ ...meta, recipe: undefined, template: { ...own, label: "古い名前" } }, "新しい名前");
    expect(t?.label).toBe("新しい名前");
  });

  it("構成が残っていない画像は雛形を作れない(同じプロンプトで別シードにする)", () => {
    expect(templateFromMeta({ ...meta, recipe: undefined }, "g")).toBeNull();
  });

  // 手元の v1 画像のメタデータで確かめるとき: V1_SIDECAR=<画像>.json pnpm test
  it.skipIf(!process.env.V1_SIDECAR)("実際の v1 のメタデータから雛形を作り、描画できる", () => {
    const real = JSON.parse(fs.readFileSync(process.env.V1_SIDECAR!, "utf8")) as ImageMetadata;
    const t = templateFromMeta(real, "real");
    expect(t).not.toBeNull();
    const out = Array.from({ length: 8 }, () => renderItem(t!));
    expect(out.every((r) => r.positive.length > 20)).toBe(true);
    console.log("distinct prompts of 8:", new Set(out.map((r) => r.positive)).size, "| loras:", out[0].loras.map((l) => l.name).join(","));
  });
});
