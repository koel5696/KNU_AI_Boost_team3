import type { ProcessedSource } from "./documentProcessor";
import type { ExtractedInfo } from "./extractor";

export type AiNoticeResponse = {
  info: ExtractedInfo;
  provider?: string;
  model?: string;
  evidence?: Partial<Record<keyof ExtractedInfo, string>>;
  warnings?: string[];
};

export type ImageQuotaResponse = {
  used: number;
  limit: number;
  remaining: number;
  date: string;
};

export type PromotionImageResponse = ImageQuotaResponse & {
  mimeType: string;
  imageData: string;
  warnings?: string[];
};

const DEFAULT_AI_API_URL = "https://notice-mate-server.o-r.kr";
const AI_API_URL = String(import.meta.env.VITE_NOTICE_AI_API_URL || DEFAULT_AI_API_URL).replace(/\/+$/, "");
const AI_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 120_000;
const DIRECT_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
  "application/vnd.hancom.hwpx",
]);
const DIRECT_ATTACHMENT_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".doc", ".docx", ".hwp", ".hwpx"]);

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function inferredMimeType(file: File) {
  if (file.type && DIRECT_ATTACHMENT_TYPES.has(file.type)) return file.type;
  switch (extensionOf(file.name)) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".hwp":
      return "application/x-hwp";
    case ".hwpx":
      return "application/vnd.hancom.hwpx";
    default:
      return "";
  }
}

function aiUploadFile(file: File) {
  const mimeType = inferredMimeType(file);
  return file.type === mimeType ? file : new File([file], file.name, { type: mimeType });
}

function compactSource(source: ProcessedSource) {
  return {
    fileName: source.fileName,
    kind: source.kind,
    text: source.text,
    links: source.links,
    qrCodes: source.qrCodes,
  };
}

function normalizeQuota(payload: Partial<ImageQuotaResponse> | undefined): ImageQuotaResponse {
  const limit = Number.isFinite(payload?.limit) ? Number(payload?.limit) : 3;
  const used = Number.isFinite(payload?.used) ? Number(payload?.used) : 0;
  const remaining = Number.isFinite(payload?.remaining) ? Number(payload?.remaining) : Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    date: typeof payload?.date === "string" ? payload.date : "",
  };
}

export function canSendOriginalToAi(file: File) {
  return DIRECT_ATTACHMENT_TYPES.has(file.type) || DIRECT_ATTACHMENT_EXTENSIONS.has(extensionOf(file.name));
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

function normalizeEvidence(evidence: Partial<Record<keyof ExtractedInfo, string>> | undefined) {
  return {
    title: evidence?.title?.trim() ?? "",
    category: evidence?.category?.trim() ?? "",
    description: evidence?.description?.trim() ?? "",
    audience: evidence?.audience?.trim() ?? "",
    period: evidence?.period?.trim() ?? "",
    benefit: evidence?.benefit?.trim() ?? "",
    applyMethod: evidence?.applyMethod?.trim() ?? "",
    contact: evidence?.contact?.trim() ?? "",
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
    formData.append("files", aiUploadFile(file), file.name);
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
      evidence: normalizeEvidence(payload.evidence),
      warnings: payload.warnings ?? [],
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function loadPromotionImageQuota(idToken: string): Promise<ImageQuotaResponse> {
  const response = await fetch(`${AI_API_URL}/api/promotion-image/quota`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Image quota failed with ${response.status}`);
  }

  return normalizeQuota((await response.json()) as ImageQuotaResponse);
}

export async function generatePromotionImageWithAi(
  mailText: string,
  sources: ProcessedSource[],
  files: File[],
  idToken: string,
): Promise<PromotionImageResponse> {
  const formData = new FormData();
  formData.append("mailText", mailText);
  formData.append("sources", JSON.stringify(sources.map(compactSource)));
  files.filter(canSendOriginalToAi).forEach((file) => {
    formData.append("files", aiUploadFile(file), file.name);
  });

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_API_URL}/api/promotion-image`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Image generation failed with ${response.status}`);
    }

    const payload = (await response.json()) as PromotionImageResponse;
    return {
      ...payload,
      ...normalizeQuota(payload),
      mimeType: payload.mimeType || "image/png",
      imageData: payload.imageData || "",
      warnings: payload.warnings ?? [],
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
