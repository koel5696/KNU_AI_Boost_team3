import { analyzeSources } from "./sourceAnalysis";
import type { ProcessedSource } from "./documentProcessor";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const mixedScheduleMail = `제목: 2026 AI 실무 교육 참가자 모집

모집 대상: 강남대학교 재학생
신청 기간: 2026년 8월 1일 09:00부터 2026년 8월 14일 18:00까지
교육 기간: 2026년 9월 1일 ~ 2026년 9월 30일
주요 혜택: 교육비 전액 무료
신청 방법: 아래 신청 링크에서 온라인 접수
https://docs.google.com/forms/d/e/example
문의: 02-1234-5678`;

const mixedSchedule = analyzeSources(mixedScheduleMail, []);
const period = mixedSchedule.info.period;
const applyMethod = mixedSchedule.info.applyMethod;

assert(period.includes("신청:"), "신청 기간 라벨이 최종 기간에 포함되어야 합니다.");
assert(period.includes("행사/운영:"), "행사/운영 기간 라벨이 최종 기간에 포함되어야 합니다.");
assert(period.includes("2026-08-01 09:00"), "신청 시작일이 정규화되어야 합니다.");
assert(period.includes("2026-08-14 18:00"), "신청 마감일이 정규화되어야 합니다.");
assert(period.includes("2026-09-01"), "행사/교육 시작일이 정규화되어야 합니다.");
assert(applyMethod.includes("docs.google.com/forms"), "신청 링크가 신청 방법에 우선 반영되어야 합니다.");
assert(mixedSchedule.fields.find((field) => field.key === "period")?.confidence ?? 0 > 0.7, "기간 신뢰도가 충분해야 합니다.");

const qrOnlySource: ProcessedSource = {
  id: "qr-source",
  fileName: "poster.png",
  kind: "image",
  text: "포스터 이미지 OCR 결과입니다. 신청은 QR 코드를 통해 진행됩니다. 문의 02-1111-2222",
  size: 1000,
  isOcr: true,
  links: [],
  qrCodes: ["https://forms.gle/knu-apply"],
  warnings: [],
};

const qrAnalysis = analyzeSources("", [qrOnlySource]);
assert(qrAnalysis.info.applyMethod.includes("https://forms.gle/knu-apply"), "QR 신청 링크가 신청 방법 후보에 포함되어야 합니다.");
assert(qrAnalysis.links.includes("https://forms.gle/knu-apply"), "QR 링크가 링크 목록에도 포함되어야 합니다.");

console.log("source-analysis-check: 후보 랭킹, 날짜 정규화, 신청 링크 우선, 기간 분리 통과");
