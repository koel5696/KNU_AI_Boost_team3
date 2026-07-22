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
  context.fillStyle = "#f4f8fc";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#06315f";
  context.fillRect(0, 0, WIDTH, 350);
  context.fillStyle = "#5dc7ef";
  context.fillRect(0, 0, 18, HEIGHT);

  context.fillStyle = "#bdeaff";
  context.font = `800 26px ${FONT_FAMILY}`;
  context.fillText(`KANGNAM UNIVERSITY · ${draft.channelLabel}`, 72, 80);
  context.fillStyle = "#ffffff";
  context.font = `900 68px ${FONT_FAMILY}`;
  wrapText(context, draft.title, 72, 174, 900, 84, 2);
  context.fillStyle = "#cceaff";
  context.font = `700 31px ${FONT_FAMILY}`;
  wrapText(context, `참여 대상 · ${draft.audience}`, 72, 310, 900, 40, 1);

  const items = [
    ["기간", draft.period],
    ["주요 혜택", draft.benefit],
    ["신청 방법", draft.applyMethod],
    ["문의", draft.contact],
  ];
  items.forEach(([label, value], index) => {
    const y = 410 + index * 195;
    context.fillStyle = "#ffffff";
    roundedRect(context, 70, y, 940, 160, 20);
    context.fill();
    context.fillStyle = "#0072bc";
    context.font = `900 27px ${FONT_FAMILY}`;
    context.fillText(label, 108, y + 54);
    context.fillStyle = "#172333";
    context.font = `800 36px ${FONT_FAMILY}`;
    wrapText(context, value, 108, y + 111, 830, 44, 2);
  });

  context.fillStyle = "#496078";
  context.font = `700 25px ${FONT_FAMILY}`;
  context.fillText("자세한 내용은 학교 홈페이지 공지를 확인해 주세요.", 72, HEIGHT - 65);
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

export async function downloadImageDraft(draft: ImageDraft) {
  await document.fonts?.ready;
  const canvas = renderImageDraft(draft);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("PNG 이미지 생성에 실패했습니다."));
    }, "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const templateName = draft.template === "promotional" ? "홍보용" : "안내용";
  link.href = url;
  link.download = `강남대학교_${draft.category.replace(/[^0-9A-Za-z가-힣]/g, "_")}_${templateName}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return link.download;
}
