// v1 の components/common/mosaic-config.tsx と process-run.ts の RunRequest のうち、設定値の部分(クライアントとサーバーで共有)。
export const NTD11_MODEL = "ntd11_anime_nsfw_segm_v5-variant1.pt";
export const NTD11_CLASSES = ["nipples", "pussy", "anus", "penis", "testicles", "x-ray", "cross-section"] as const;
export const CLASS_LABELS: Record<string, string> = {
  nipples: "乳首",
  pussy: "女性器",
  anus: "肛門",
  penis: "男性器",
  testicles: "睾丸",
  "x-ray": "透視",
  "cross-section": "断面",
};

export const DEFAULT_MOSAIC = {
  mosaicSize: 34,
  autoSize: false,
  confidence: 0.2,
  models: [NTD11_MODEL],
  targetClasses: ["pussy", "penis", "anus", "x-ray", "cross-section"] as string[],
  device: "",
  retinaMasks: true,
  useMasks: true,
  noMeta: true,
  bboxExpand: 2,
};
export type MosaicSettings = typeof DEFAULT_MOSAIC;

/** v1 のギャラリーからのモザイク処理と同じ既定: 先に40%へ縮小してからモザイクをかける */
export const DEFAULT_RESIZE = { scalePercent: 40, quality: 92 };
export type ResizeSettings = typeof DEFAULT_RESIZE;

export interface MosaicRunRequest {
  /** ギャラリーのフォルダ名(<folder>_release の中の画像が対象) */
  folder: string;
  /** 指定時は、このフォルダ直下のこれらのファイルだけ処理する */
  files?: string[];
  /** false ならモザイクをかけず、縮小だけ行う(出力は resized/) */
  mosaicEnabled: boolean;
  resizeEnabled: boolean;
  mosaic: MosaicSettings;
  resize: ResizeSettings;
}

export interface MosaicResult {
  filename: string;
  /** 検出して塗った箇所の数。0 = 対象なし */
  regionCount: number;
  /** 保存された出力(出力フォルダからの相対パス) */
  outputPath: string | null;
}

/** automosaic.py の出力名 "<元stem>_mosaic[連番].<ext>" から元stemを取り出す */
export const MOSAIC_NAME = /^(.+)_mosaic\d*$/;
