import type { ProcessedSource } from "./documentProcessor";
import type { ExtractedInfo } from "./extractor";

export type AiNoticeResponse = {
  info: ExtractedInfo;
  provider?: string;
  model?: string;
  warnings?: string[];
};

const DEFAULT_AI_API_URL = "https://notice-mate-server.o-r.kr";
const AI_API_URL = String(import.meta.env.VITE_NOTICE_AI_API_URL || DEFAULT_AI_API_URL).replace(/\/+$/, "");
const AI_TIMEOUT_MS = 60_000;
const DIRECT_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
]);

function compactSource(source: ProcessedSource) {
  return {
    fileName: source.fileName,
    kind: source.kind,
    text: source.text,
    links: source.links,
    qrCodes: source.qrCodes,
  };
}

export function canSendOriginalToAi(file: File) {
  return DIRECT_ATTACHMENT_TYPES.has(file.type);
}

function normalizeInfo(info: Partial<ExtractedInfo> | undefined): ExtractedInfo {
  return {
    title: info?.title?.trim() ?? "",
    category: info?.category?.trim() ?? "",
    description: info?.description?.trim() ?? "",
    audience: info?.audience?.trim() ?? "",
    period: info?.period?.trim() ?? "",
    benefit: info?.benefit?.trim() ?? "",
    applyMethod: info?.applyMethod?.trim() ?? "",
    contact: info?.contact?.trim() ?? "",
  };
}

export async function analyzeNoticeWithAi(
  mailText: string,
  sources: ProcessedSource[],
  files: File[],
): Promise<AiNoticeResponse> {
  const formData = new FormData();
  formData.append("mailText", mailText);
  formData.append("sources", JSON.stringify(sources.map(compactSource)));
  files.filter(canSendOriginalToAi).forEach((file) => {
    formData.append("files", file, file.name);
  });

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_API_URL}/api/analyze-notice-with-files`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI analysis failed with ${response.status}`);
    }

    const payload = (await response.json()) as AiNoticeResponse;
    return {
      ...payload,
      info: normalizeInfo(payload.info),
      warnings: payload.warnings ?? [],
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
