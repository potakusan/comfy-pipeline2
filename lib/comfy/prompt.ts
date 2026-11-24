// v1 の lib/comfy/prompt-assembly.ts と同じ組み立て規則(順序・コメント行除去・出力プレフィックス)。
import type { LoraEntry, Preset } from "./comfy-types";

export const SIZE_PRESETS = [
  { label: "横長", width: 1536, height: 1136 },
  { label: "正方形", width: 1024, height: 1024 },
  { label: "3:4", width: 1152, height: 1536 },
  { label: "縦長", width: 960, height: 1600 },
] as const;

export function sanitizeFilePrefix(name: string): string {
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").trim().substring(0, 40);
}

export function buildOutputPrefix(loraName: string, filePrefix?: string): string {
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const safeName = sanitizeFilePrefix(loraName || "no-lora");
  const safePrefix = filePrefix ? sanitizeFilePrefix(filePrefix) : "out";
  return `${dateStr}-${safeName}/${safePrefix}`;
}

export function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

export function stripCommentLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isCommentLine(line))
    .join("\n");
}

export function assemblePositivePrompt(args: {
  fixedPrefix: string;
  fixedLoras: LoraEntry[];
  variableLora: LoraEntry | null;
  /** 順序つきのプリセット(身体→人数→ポーズ→シーン→その他)と、抽選済みのプロンプト */
  presetParts: { preset: Preset; prompt: string }[];
  additionalPrompt: string;
}): string {
  const parts: string[] = [stripCommentLines(args.fixedPrefix)];
  for (const lora of args.fixedLoras) {
    if (lora.triggerWords?.trim()) parts.push(lora.triggerWords.trim());
  }
  if (args.variableLora?.triggerWords?.trim()) parts.push(args.variableLora.triggerWords.trim());
  for (const { preset, prompt } of args.presetParts) {
    const p = stripCommentLines(prompt);
    if (p.trim()) parts.push(p);
    if (preset.lora?.triggerWords?.trim()) parts.push(preset.lora.triggerWords.trim());
  }
  const extra = stripCommentLines(args.additionalPrompt).trim();
  if (extra) parts.push(extra);
  return parts.join("\n\n");
}
