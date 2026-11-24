import fs from "fs";
import path from "path";
import { getOutputDir, IMAGE_EXT, safePath } from "./env";
import { getPoseGroup } from "@/lib/comfy/group";
import type { ImageMetadata } from "@/lib/comfy/comfy-types";
import type { ItemTemplate } from "@/lib/comfy/item";

/**
 * 「このプリセットをあと n 枚」: 同じ接頭辞(プリセット名)の画像から、元の構成を探す。
 * v2 の画像は雛形(template)を、v1 の画像は生成レシピ(recipe)を持つ。どちらも無い画像は、
 * 同じプロンプトで別シードにするしかない(ランダム部分は引き直せない)。
 */
export interface MoreSource {
  meta: ImageMetadata;
  filename: string;
  /** null = 雛形を作れない(同じプロンプト・別シードで作る) */
  template: ItemTemplate | null;
}

const natural = (a: string, b: string) => a.localeCompare(b, "ja", { numeric: true });

export function templateFromMeta(meta: ImageMetadata, label: string): ItemTemplate | null {
  if (!meta.settings) return null;
  if (meta.template) return { ...meta.template, label, settings: { ...meta.settings, randomizeSeed: true } };
  const r = meta.recipe;
  if (!r) return null;
  return {
    label,
    loraName: meta.loraName,
    variableLora: r.variableLora,
    fixedLoras: r.fixedLoras,
    fixedTags: r.fixedTags,
    presets: {
      physical: r.presets.selectedPhysicals,
      count: r.presets.selectedCount,
      pose: r.presets.selectedPose,
      scene: r.presets.selectedScene,
      other: r.presets.selectedOthers,
    },
    additionalLines: r.additionalPrompt.lines,
    additionalMode: r.additionalPrompt.mode,
    variationTags: r.variationTags,
    negativePrompt: r.negativePrompt ?? meta.negativePrompt ?? "",
    settings: { ...meta.settings, randomizeSeed: true },
    variableDefs: r.variableDefs,
    // 入力モードの変数は前回の値を引き継ぐ(ランダム・固定の変数は定義どおり)
    variableValues: meta.bindings ?? r.variableInputValues ?? {},
  };
}

export function findMoreSource(folder: string, group: string): MoreSource | null {
  const dir = safePath(getOutputDir(), folder);
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f) && getPoseGroup(f) === group)
    .sort(natural)
    .reverse(); // いちばん新しい画像から探す
  let fallback: MoreSource | null = null;
  for (const filename of files) {
    let meta: ImageMetadata;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, `${filename}.json`), "utf8")) as ImageMetadata;
    } catch {
      continue;
    }
    if (!meta.settings || meta.mode !== "normal") continue; // カップルモードは対象外
    const template = templateFromMeta(meta, group);
    if (template) return { meta, filename, template };
    fallback ??= { meta, filename, template: null };
  }
  return fallback;
}
