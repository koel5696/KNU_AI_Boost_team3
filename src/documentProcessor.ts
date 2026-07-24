import type { Attachment } from "postal-mime";

export type DocumentKind = "email" | "image" | "pdf" | "docx" | "spreadsheet" | "text";

export type ProcessedSource = {
  id: string;
  fileName: string;
  kind: DocumentKind;
  text: string;
  page?: number;
  size: number;
  isOcr: boolean;
  links: string[];
  qrCodes: string[];
  warnings: string[];
};

export type ProcessingProgress = {
  progress: number;
  message: string;
};

export type ProgressCallback = (progress: ProcessingProgress) => void;

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_FILES = 8;
export const ACCEPTED_FILE_TYPES = [
  ".eml",
  ".txt",
  ".html",
  ".htm",
  ".pdf",
  ".docx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".heic",
  ".heif",
].join(",");

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractLinks(text: string) {
  return unique(text.match(URL_PATTERN) ?? []);
}

function cleanText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToText(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
  document.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  document
    .querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6")
    .forEach((node) => node.append("\n"));
  return cleanText(document.body.textContent ?? "");
}

function trimOldConversation(text: string) {
  const markers = [
    /^-{2,}\s*(?:Original Message|Forwarded message|전달된 메시지|원본 메시지)\s*-{0,}$/im,
    /^(?:From|보낸 사람)\s*:\s*.+$/im,
  ];
  let end = text.length;
  for (const marker of markers) {
    const index = text.search(marker);
    if (index > 80 && index < end) end = index;
  }
  return cleanText(text.slice(0, end));
}

function source(
  file: File,
  kind: DocumentKind,
  text: string,
  extra: Partial<ProcessedSource> = {},
): ProcessedSource {
  const normalizedText = cleanText(text);
  return {
    id: makeId(),
    fileName: file.name,
    kind,
    text: normalizedText,
    size: file.size,
    isOcr: false,
    links: extractLinks(normalizedText),
    qrCodes: [],
    warnings: [],
    ...extra,
  };
}

function attachmentToFile(attachment: Attachment) {
  const content =
    typeof attachment.content === "string"
      ? new TextEncoder().encode(attachment.content)
      : attachment.content;
  return new File([content], attachment.filename || "attachment", {
    type: attachment.mimeType || "application/octet-stream",
  });
}

async function processEmail(file: File, onProgress?: ProgressCallback, depth = 0) {
  const { default: PostalMime } = await import("postal-mime");
  const email = await PostalMime.parse(await file.arrayBuffer(), {
    attachmentEncoding: "arraybuffer",
    maxNestingDepth: 2,
  });
  const body = trimOldConversation(email.text || htmlToText(email.html || ""));
  const metadata = [
    email.subject ? `제목: ${email.subject}` : "",
    email.from && "address" in email.from
      ? `보낸 사람: ${email.from.name || email.from.address} <${email.from.address}>`
      : "",
    email.date ? `보낸 날짜: ${email.date}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const results = [source(file, "email", `${metadata}\n\n${body}`)];

  if (depth >= 1 || !email.attachments.length) return results;

  for (let index = 0; index < email.attachments.length; index += 1) {
    const attachment = email.attachments[index];
    onProgress?.({
      progress: 15 + Math.round(((index + 1) / email.attachments.length) * 80),
      message: `첨부파일 처리 중: ${attachment.filename || "이름 없는 첨부파일"}`,
    });
    try {
      const attachmentSources = await processDocumentFile(
        attachmentToFile(attachment),
        onProgress,
        depth + 1,
      );
      results.push(...attachmentSources);
    } catch (error) {
      results[0].warnings.push(`${attachment.filename || "첨부파일"}: ${errorMessage(error)}`);
    }
  }
  return results;
}

async function processDocx(file: File) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const warnings = result.messages.map((message) => message.message);
  return [source(file, "docx", result.value, { warnings })];
}

function spreadsheetCellText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString("ko-KR");
  return String(value).trim();
}

async function processSpreadsheet(file: File) {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const sections = sheets
    .map((sheet) => {
      const rows = sheet.data
        .map((row) => row.map(spreadsheetCellText).filter(Boolean).join(" | "))
        .filter(Boolean);
      return rows.length ? `[시트: ${sheet.sheet}]\n${rows.join("\n")}` : "";
    })
    .filter(Boolean);

  return [
    source(file, "spreadsheet", sections.join("\n\n"), {
      warnings: sections.length ? [] : ["스프레드시트에서 분석할 텍스트를 찾지 못했습니다."],
    }),
  ];
}

async function loadImage(file: File) {
  let renderable: Blob = file;
  const extension = extensionOf(file.name);
  if (extension === ".heic" || extension === ".heif") {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    renderable = Array.isArray(converted) ? converted[0] : converted;
  }

  const url = URL.createObjectURL(renderable);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("이미지를 읽을 수 없습니다.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scanQrCode(canvas: HTMLCanvasElement) {
  const jsqr = (await import("jsqr")).default;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsqr(imageData.data, imageData.width, imageData.height);
  return result?.data ? [result.data] : [];
}

async function recognizeCanvas(canvas: HTMLCanvasElement, onProgress?: ProgressCallback) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("kor+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        onProgress?.({
          progress: Math.round(message.progress * 100),
          message: "이미지 문자 인식 중",
        });
      }
    },
  });
  try {
    const result = await worker.recognize(canvas);
    return cleanText(result.data.text);
  } finally {
    await worker.terminate();
  }
}

async function processImage(file: File, onProgress?: ProgressCallback) {
  onProgress?.({ progress: 12, message: "이미지 읽는 중" });
  const canvas = await loadImage(file);
  const qrCodes = await scanQrCode(canvas);
  onProgress?.({ progress: 35, message: "OCR 준비 중" });
  const text = await recognizeCanvas(canvas, onProgress);
  return [
    source(file, "image", text, {
      isOcr: true,
      qrCodes,
      links: unique([...extractLinks(text), ...qrCodes.filter((value) => /^https?:\/\//i.test(value))]),
      warnings: text ? [] : ["이미지에서 문자를 찾지 못했습니다."],
    }),
  ];
}

async function processPdf(file: File, onProgress?: ProgressCallback) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const results: ProcessedSource[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.({
      progress: Math.round(((pageNumber - 1) / pdf.numPages) * 90) + 5,
      message: `PDF ${pageNumber}/${pdf.numPages}페이지 분석 중`,
    });
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = cleanText(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
    let isOcr = false;
    let qrCodes: string[] = [];

    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      qrCodes = await scanQrCode(canvas);
      if (text.replace(/\s/g, "").length < 20) {
        isOcr = true;
        text = await recognizeCanvas(canvas, ({ progress, message }) =>
          onProgress?.({
            progress: Math.min(
              95,
              Math.round(((pageNumber - 1) / pdf.numPages) * 90 + progress / pdf.numPages),
            ),
            message: `${pageNumber}페이지 ${message}`,
          }),
        );
      }
    }

    results.push(
      source(file, "pdf", text, {
        page: pageNumber,
        isOcr,
        qrCodes,
        links: unique([...extractLinks(text), ...qrCodes.filter((value) => /^https?:\/\//i.test(value))]),
        warnings: text ? [] : ["이 페이지에서 문자를 찾지 못했습니다."],
      }),
    );
  }
  return results;
}

export function supportsFile(file: File) {
  return ACCEPTED_FILE_TYPES.split(",").includes(extensionOf(file.name));
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (/password|encrypted/i.test(error.message)) return "암호화된 문서는 처리할 수 없습니다.";
    return error.message;
  }
  return "파일을 처리하지 못했습니다.";
}

export async function processDocumentFile(
  file: File,
  onProgress?: ProgressCallback,
  depth = 0,
): Promise<ProcessedSource[]> {
  if (file.size > MAX_FILE_SIZE) throw new Error("파일 크기는 20MB 이하여야 합니다.");
  if (!supportsFile(file)) throw new Error("지원하지 않는 파일 형식입니다.");

  const extension = extensionOf(file.name);
  onProgress?.({ progress: 2, message: "파일 형식 확인 중" });

  if (extension === ".eml") return processEmail(file, onProgress, depth);
  if (extension === ".docx") return processDocx(file);
  if (extension === ".xlsx") return processSpreadsheet(file);
  if (extension === ".pdf") return processPdf(file, onProgress);
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".heic", ".heif"].includes(extension)) {
    return processImage(file, onProgress);
  }
  if (extension === ".html" || extension === ".htm") {
    return [source(file, "text", htmlToText(await file.text()))];
  }
  return [source(file, "text", await file.text())];
}
