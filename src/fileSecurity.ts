const TEXT_EXTENSIONS = new Set([".txt", ".html", ".htm", ".eml"]);
const ZIP_EXTENSIONS = new Set([".docx", ".hwpx", ".xlsx"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".heic", ".heif"]);
const UNSAFE_BINARY_EXTENSIONS = new Set([".doc", ".hwp"]);
const MAX_ZIP_ENTRIES = 2_000;

export function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function hasBytes(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function isZip(bytes: Uint8Array) {
  return hasBytes(bytes, [0x50, 0x4b, 0x03, 0x04])
    || hasBytes(bytes, [0x50, 0x4b, 0x05, 0x06])
    || hasBytes(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

function isImageSignature(extension: string, bytes: Uint8Array) {
  if (extension === ".png") return hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === ".jpg" || extension === ".jpeg") return hasBytes(bytes, [0xff, 0xd8, 0xff]);
  if (extension === ".webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  if (extension === ".bmp") return hasBytes(bytes, [0x42, 0x4d]);
  if (extension === ".heic" || extension === ".heif") return ascii(bytes, 4, 8) === "ftyp";
  return false;
}

async function validateZipDocument(file: File, extension: string) {
  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(archive.files);
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new Error("압축 내부 항목이 너무 많은 파일은 처리할 수 없습니다.");
  }
  if (names.some((name) => name.includes("..") || name.startsWith("/") || /^[A-Za-z]:/.test(name))) {
    throw new Error("안전하지 않은 내부 경로가 포함된 파일은 처리할 수 없습니다.");
  }

  if (extension === ".docx" && !names.includes("word/document.xml")) {
    throw new Error("정상적인 DOCX 문서 구조가 아닙니다.");
  }
  if (extension === ".xlsx" && !names.includes("xl/workbook.xml")) {
    throw new Error("정상적인 XLSX 문서 구조가 아닙니다.");
  }
  if (extension === ".hwpx" && !names.some((name) => /(?:^|\/)(?:Contents\/)?section[0-9]+\.xml$/i.test(name))) {
    throw new Error("정상적인 HWPX 문서 구조가 아닙니다.");
  }
}

export async function assertSafeFile(file: File) {
  const extension = extensionOf(file.name);
  if (UNSAFE_BINARY_EXTENSIONS.has(extension)) {
    throw new Error("보안 검증이 어려운 DOC/HWP 바이너리 파일은 업로드할 수 없습니다. DOCX 또는 HWPX로 변환해 주세요.");
  }
  if (TEXT_EXTENSIONS.has(extension)) return;

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (extension === ".pdf") {
    if (!hasBytes(header, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      throw new Error("PDF 확장자와 실제 파일 형식이 일치하지 않습니다.");
    }
    return;
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    if (!isImageSignature(extension, header)) {
      throw new Error("이미지 확장자와 실제 파일 형식이 일치하지 않습니다.");
    }
    return;
  }
  if (ZIP_EXTENSIONS.has(extension)) {
    if (!isZip(header)) {
      throw new Error("문서 확장자와 실제 파일 형식이 일치하지 않습니다.");
    }
    await validateZipDocument(file, extension);
  }
}
