import type { ExtractedInfo } from "./extractor";

export type ImageTemplate = "promotional" | "informational";

export type ImageDraft = {
  template: ImageTemplate;
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
  template: ImageTemplate,
): ImageDraft {
  const category = info.category || "프로그램";
  return {
    template,
    channelLabel,
    category,
    title: template === "promotional" ? `${category} 참여자를 모집합니다!` : `${category} 프로그램 안내`,
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

function drawInformational(context: CanvasRenderingContext2D, draft: ImageDraft) {
  context.fillStyle = "#eef3f8";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const headerGradient = context.createLinearGradient(0, 0, WIDTH, 440);
  headerGradient.addColorStop(0, "#052b57");
  headerGradient.addColorStop(1, "#0a568d");
  context.fillStyle = headerGradient;
  context.fillRect(0, 0, WIDTH, 440);

  context.strokeStyle = "rgba(130,215,255,0.18)";
  context.lineWidth = 28;
  context.beginPath();
  context.arc(1010, 35, 190, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(92, 75, 35, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#06315f";
  context.font = `900 18px ${FONT_FAMILY}`;
  context.textAlign = "center";
  context.fillText("KNU", 92, 82);
  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = `800 24px ${FONT_FAMILY}`;
  context.fillText("KANGNAM UNIVERSITY", 145, 72);
  context.fillStyle = "#9fdcff";
  context.font = `700 18px ${FONT_FAMILY}`;
  context.fillText("NOTICE HELPER", 145, 99);

  context.fillStyle = "rgba(255,255,255,0.13)";
  roundedRect(context, 795, 55, 215, 48, 24);
  context.fill();
  context.fillStyle = "#d7f1ff";
  context.font = `800 18px ${FONT_FAMILY}`;
  context.textAlign = "center";
  context.fillText(`${draft.channelLabel} · OFFICIAL`, 902, 86);
  context.textAlign = "left";

  context.fillStyle = "#55c6ef";
  roundedRect(context, 72, 132, 245, 45, 22);
  context.fill();
  context.fillStyle = "#052b57";
  context.font = `900 21px ${FONT_FAMILY}`;
  context.fillText(draft.category, 94, 162);

  context.fillStyle = "#ffffff";
  context.font = `900 61px ${FONT_FAMILY}`;
  const titleBottom = wrapText(context, draft.title, 72, 237, 900, 73, 2);
  const audienceY = Math.min(titleBottom + 8, 372);
  context.fillStyle = "rgba(255,255,255,0.12)";
  roundedRect(context, 72, audienceY, 936, 52, 14);
  context.fill();
  context.fillStyle = "#d8f2ff";
  context.font = `700 25px ${FONT_FAMILY}`;
  wrapText(context, `참여 대상  |  ${draft.audience}`, 98, audienceY + 34, 860, 32, 1);

  context.fillStyle = "#173d63";
  context.font = `900 30px ${FONT_FAMILY}`;
  context.fillText("한눈에 보는 핵심 안내", 72, 491);
  context.fillStyle = "#58bde6";
  context.fillRect(72, 510, 936, 5);

  const items = [
    ["01", "기간", draft.period, "#eaf6fd"],
    ["02", "주요 혜택", draft.benefit, "#fff9e7"],
    ["03", "신청 방법", draft.applyMethod, "#ffffff"],
    ["04", "문의", draft.contact, "#ffffff"],
  ];
  items.forEach(([number, label, value, background], index) => {
    const y = 542 + index * 174;
    context.save();
    context.shadowColor = "rgba(19,55,88,0.09)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 6;
    context.fillStyle = background;
    roundedRect(context, 70, y, 940, 150, 18);
    context.fill();
    context.restore();
    context.fillStyle = index === 1 ? "#ffcc3d" : "#0b73b7";
    roundedRect(context, 96, y + 30, 62, 62, 16);
    context.fill();
    context.fillStyle = index === 1 ? "#4c3a00" : "#ffffff";
    context.font = `900 22px ${FONT_FAMILY}`;
    context.textAlign = "center";
    context.fillText(number, 127, y + 70);
    context.textAlign = "left";
    context.fillStyle = "#53708b";
    context.font = `800 22px ${FONT_FAMILY}`;
    context.fillText(label, 190, y + 48);
    context.fillStyle = "#172333";
    context.font = `900 32px ${FONT_FAMILY}`;
    wrapText(context, value, 190, y + 96, 760, 39, 2);
  });

  context.fillStyle = "#06315f";
  context.fillRect(0, HEIGHT - 82, WIDTH, 82);
  context.fillStyle = "#d7f1ff";
  context.font = `700 23px ${FONT_FAMILY}`;
  context.textAlign = "center";
  context.fillText("게시 전 학교 홈페이지에서 상세 내용을 확인해 주세요.", WIDTH / 2, HEIGHT - 32);
  context.textAlign = "left";
}

function renderImageDraft(draft: ImageDraft) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 캔버스를 만들 수 없습니다.");

  context.textBaseline = "alphabetic";
  if (draft.template === "promotional") drawPromotional(context, draft);
  else drawInformational(context, draft);
  return canvas;
}

export function downloadImageDraft(draft: ImageDraft) {
  const canvas = renderImageDraft(draft);
  const templateName = draft.template === "promotional" ? "홍보용" : "안내용";
  const fileName = `강남대학교_${draft.category.replace(/[^0-9A-Za-z가-힣]/g, "_")}_${templateName}.png`;
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
