import type { ExtractedInfo } from "./extractor";

export type ImageDraft = {
  channelLabel: string;
  category: string;
  title: string;
  audience: string;
  period: string;
  benefit: string;
  applyMethod: string;
  contact: string;
};

const NEEDS_REVIEW = "담당자 확인 필요";
const WIDTH = 1080;
const HEIGHT = 1350;
const FONT_FAMILY = 'Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif';

export function buildImageDraft(
  info: ExtractedInfo,
  channelLabel: string,
): ImageDraft {
  const category = info.category || "프로그램";
  return {
    channelLabel,
    category,
    title: `${category} 참여자를 모집합니다!`,
    audience: info.audience || NEEDS_REVIEW,
    period: info.period || NEEDS_REVIEW,
    benefit: info.benefit || NEEDS_REVIEW,
    applyMethod: info.applyMethod || NEEDS_REVIEW,
    contact: info.contact || NEEDS_REVIEW,
  };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
) {
  const characters = Array.from(text);
  const lines: string[] = [];
  let line = "";

  for (const character of characters) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line.trim());
      line = character;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }

  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  const hasOverflow = lines.join("").length < text.replace(/\s/g, "").length;
  if (hasOverflow && lines.length) {
    let lastLine = lines.at(-1) || "";
    while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = lastLine.slice(0, -1);
    }
    lines[lines.length - 1] = `${lastLine.trim()}…`;
  }

  lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawPromotional(context: CanvasRenderingContext2D, draft: ImageDraft) {
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#052b57");
  gradient.addColorStop(0.58, "#006bb6");
  gradient.addColorStop(1, "#12a4d9");
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.globalAlpha = 0.12;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(960, 140, 270, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(70, 1170, 210, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = "rgba(255,255,255,0.14)";
  roundedRect(context, 72, 70, 500, 68, 34);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `800 28px ${FONT_FAMILY}`;
  context.fillText(`KANGNAM UNIVERSITY · ${draft.channelLabel}`, 102, 114);

  context.fillStyle = "#bdeaff";
  context.font = `800 30px ${FONT_FAMILY}`;
  context.fillText(draft.category, 76, 236);
  context.fillStyle = "#ffffff";
  context.font = `900 78px ${FONT_FAMILY}`;
  const titleBottom = wrapText(context, draft.title, 72, 330, 900, 100, 3);

  context.fillStyle = "#d9f3ff";
  context.font = `700 35px ${FONT_FAMILY}`;
  wrapText(context, `대상 · ${draft.audience}`, 76, titleBottom + 24, 880, 48, 1);

  const benefitY = Math.max(580, titleBottom + 100);
  context.fillStyle = "#ffdc61";
  roundedRect(context, 72, benefitY, 936, 170, 30);
  context.fill();
  context.fillStyle = "#3d3100";
  context.font = `800 27px ${FONT_FAMILY}`;
  context.fillText("주요 혜택", 112, benefitY + 57);
  context.font = `900 46px ${FONT_FAMILY}`;
  wrapText(context, draft.benefit, 112, benefitY + 126, 850, 58, 2);

  const itemY = benefitY + 205;
  drawPromoItem(context, "기간", draft.period, 72, itemY);
  drawPromoItem(context, "신청", draft.applyMethod, 72, itemY + 130);

  context.fillStyle = "rgba(4,34,70,0.62)";
  roundedRect(context, 72, HEIGHT - 120, 936, 70, 18);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `700 27px ${FONT_FAMILY}`;
  wrapText(context, `문의  ${draft.contact}`, 108, HEIGHT - 76, 850, 36, 1);
}

function drawPromoItem(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
) {
  context.fillStyle = "rgba(255,255,255,0.13)";
  roundedRect(context, x, y, 936, 110, 22);
  context.fill();
  context.fillStyle = "#aee7ff";
  context.font = `800 27px ${FONT_FAMILY}`;
  context.fillText(label, x + 36, y + 48);
  context.fillStyle = "#ffffff";
  context.font = `800 34px ${FONT_FAMILY}`;
  wrapText(context, value, x + 150, y + 49, 730, 42, 2);
}

function renderImageDraft(draft: ImageDraft) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 캔버스를 만들 수 없습니다.");

  context.textBaseline = "alphabetic";
  drawPromotional(context, draft);
  return canvas;
}

export function downloadImageDraft(draft: ImageDraft) {
  const canvas = renderImageDraft(draft);
  const fileName = `강남대학교_${draft.category.replace(/[^0-9A-Za-z가-힣]/g, "_")}_홍보용.png`;
  const link = document.createElement("a");

  // Keep image creation and the download click in the original user gesture.
  // Some browsers block the previous asynchronous Blob download after the
  // click's user activation has expired.
  link.href = canvas.toDataURL("image/png");
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }

  return fileName;
}
