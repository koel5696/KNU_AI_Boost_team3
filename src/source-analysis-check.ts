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

const counselingMail = `[강남대학교 마음나눔센터] 재학생 여러분 안녕하세요~
마음나눔센터에서 2026-1학기 여름방학을 함께할 집단상담 참가자를 모집합니다.
신청방법
아래 구글폼 링크를 통해 신청해 주세요.
https://forms.gle/CennFpDmh2x545oy8`;

const counselingPoster: ProcessedSource = {
  id: "counseling-poster",
  fileName: "image.png",
  kind: "image",
  text: `2026-1학기 여름방학 집단상담
주제 집단상담명 기간 및 시간 총시간 인원 집단내용 방식
스트레스 관리 스트레스 레드레드 스트레스 관리 그린그린
2026.06.23~2026.07.28 매주 화요일, 총 6회기 10:00~12:00 (2시간)
12시간 10명 이내 나의 스트레스 지도 명상과 바디스캔 합리적 사고 연습 대면
미루기 습관 내일부터 말고, 내 '일'부터!
2026.06.24~2026.07.22 매주 수요일, 총 5회기 14:00~17:00 (3시간)
15시간 10명 이내 나의 미루기 연대기 미루기 그래프 대면
자기이해 "모자지싸" 모두가 자신의 진로결정과 싸우고 있다
2026.06.25 ~ 2026.07.16 매주 목요일, 총 4회기 13:00~16:00 (3시간)
12시간 10명 이내 CST 나의 강점검사 진로가치관 탐색 대면
신청 QR https://m.site.naver.com/2a1CO
문의: Or2LHsMIE 031-899-7205`,
  size: 1000,
  isOcr: true,
  links: ["https://m.site.naver.com/2a1CO"],
  qrCodes: ["https://m.site.naver.com/2a1CO"],
  warnings: [],
};

const counselingAnalysis = analyzeSources(counselingMail, [counselingPoster]);
assert(counselingAnalysis.info.audience === "재학생", "집단상담 대상은 인사말이 아니라 재학생으로 정리되어야 합니다.");
assert(counselingAnalysis.info.contact === "031-899-7205", "OCR 잡음 없이 문의 전화번호만 정리되어야 합니다.");
assert(counselingAnalysis.fields.find((field) => field.key === "contact")?.evidence === "문의: 031-899-7205", "문의처 근거 표시에서도 OCR 잡음이 제거되어야 합니다.");
assert(counselingAnalysis.info.applyMethod.includes("forms.gle/CennFpDmh2x545oy8"), "본문의 구글폼 신청 링크가 우선되어야 합니다.");
assert(counselingAnalysis.info.period.includes("스트레스 관리"), "스트레스 관리 프로그램 기간이 포함되어야 합니다.");
assert(counselingAnalysis.info.period.includes("2026-06-23 ~ 2026-07-28"), "스트레스 관리 기간이 정규화되어야 합니다.");
assert(counselingAnalysis.info.period.includes("미루기 습관"), "미루기 습관 프로그램 기간이 포함되어야 합니다.");
assert(counselingAnalysis.info.period.includes("2026-06-24 ~ 2026-07-22"), "미루기 습관 기간이 정규화되어야 합니다.");
assert(counselingAnalysis.info.period.includes("자기이해"), "자기이해 프로그램 기간이 포함되어야 합니다.");
assert(counselingAnalysis.info.period.includes("2026-06-25 ~ 2026-07-16"), "자기이해 기간이 정규화되어야 합니다.");

const genericTableSource: ProcessedSource = {
  id: "generic-table",
  fileName: "generic-table.png",
  kind: "image",
  text: `프로그램명 기간 및 시간 인원 방식
AI 기초 캠프
2026.08.01~2026.08.05 매일 10:00~12:00 20명 이내 대면
데이터 분석 실습
2026.08.12 ~ 2026.08.14 매일 13:00~16:00 15명 이내 온라인`,
  size: 1000,
  isOcr: true,
  links: [],
  qrCodes: [],
  warnings: [],
};

const genericTableAnalysis = analyzeSources("재학생 대상 방학 프로그램 참가자를 모집합니다.", [genericTableSource]);
assert(genericTableAnalysis.info.period.includes("AI 기초 캠프"), "일반 표의 첫 번째 프로그램명이 포함되어야 합니다.");
assert(genericTableAnalysis.info.period.includes("2026-08-01 ~ 2026-08-05"), "일반 표의 첫 번째 기간이 정규화되어야 합니다.");
assert(genericTableAnalysis.info.period.includes("데이터 분석 실습"), "일반 표의 두 번째 프로그램명이 포함되어야 합니다.");
assert(genericTableAnalysis.info.period.includes("2026-08-12 ~ 2026-08-14"), "일반 표의 두 번째 기간이 정규화되어야 합니다.");

const greetingAudienceAnalysis = analyzeSources("대학생 여러분 안녕하세요. 진로센터에서 프로그램 참가자를 모집합니다.", []);
assert(greetingAudienceAnalysis.info.audience === "대학생", "일반 인사말 문장에서 대상 명사만 추출되어야 합니다.");

const publicAgencyMail = `제목: 2026 청년 디지털 역량 강화 교육생 모집 안내

모집 대상: 서울 거주 만 19세~34세 미취업 청년
교육 기간: 2026. 8. 24.(월)~9. 18.(금)
모집 마감: 2026. 8. 14.(금) 18:00
참가 비용: 전액 무료
신청 방법: 센터 홈페이지 온라인 신청
문의: 서울청년지원센터 교육운영팀 02-1111-2222`;

const publicAgencyAnalysis = analyzeSources(publicAgencyMail, []);
assert(publicAgencyAnalysis.info.period.includes("신청: 2026-08-14 18:00"), "요일이 포함된 신청 마감일이 정규화되어야 합니다.");
assert(publicAgencyAnalysis.info.period.includes("행사/운영: 2026-08-24 ~ 2026-09-18"), "연도가 생략된 교육 종료일이 정규화되어야 합니다.");
assert(publicAgencyAnalysis.info.contact === "02-1111-2222", "문의처에서 부서명 대신 전화번호가 선택되어야 합니다.");

const municipalityMail = `가. 접수 기간: 2026. 8. 10.~9. 4.
나. 참가 자격: 시정에 관심 있는 국민 누구나
다. 제출 방법: 담당자 이메일 접수
라. 시상 규모: 총상금 1,000만 원
연락처: 031-444-5555`;

const municipalityAnalysis = analyzeSources(municipalityMail, []);
assert(municipalityAnalysis.info.period === "2026-08-10 ~ 2026-09-04", "지자체형 축약 날짜 범위가 정규화되어야 합니다.");
assert(municipalityAnalysis.info.applyMethod === "담당자 이메일 접수", "담당자 이메일 접수는 신청 방법으로 유지되어야 합니다.");

const overseasMail = `Subject: Call for Participants – Global Youth Leadership Program 2026

Program Period: October 12–16, 2026
Eligibility: Undergraduate students aged 18–25
Application Deadline: August 31, 2026, 23:59 KST
Contact: globalprogram@example.sg`;

const overseasAnalysis = analyzeSources(overseasMail, []);
assert(overseasAnalysis.info.category === "모집", "영문 모집 안내도 유형이 비어 있지 않아야 합니다.");
assert(overseasAnalysis.info.period.includes("신청: August 31, 2026, 23:59 KST"), "영문 신청 마감이 기간에 포함되어야 합니다.");
assert(overseasAnalysis.info.period.includes("행사/운영: October 12 ~ 16, 2026"), "영문 프로그램 기간이 기간에 포함되어야 합니다.");

const internalPhoneAnalysis = analyzeSources("내선번호: 3051", []);
assert(internalPhoneAnalysis.info.contact === "내선 3051", "내선번호도 문의처로 추출되어야 합니다.");

const correctionMail = `기존 마감일: 2026년 8월 7일
변경 마감일: 2026년 8월 16일 오후 6시
문의: 청년정책네트워크 운영팀
02-7777-8888 / youth@example.kr`;

const correctionAnalysis = analyzeSources(correctionMail, []);
assert(correctionAnalysis.info.period === "2026-08-16까지", "수정 안내에서는 변경 마감일이 기존 마감일보다 우선되어야 합니다.");
assert(correctionAnalysis.info.contact === "02-7777-8888", "문의처에서 운영팀명 대신 연락 가능한 값이 선택되어야 합니다.");

const smallAssociationAnalysis = analyzeSources("다음 달에 취업 특강을 엽니다. 참가비는 없고 온라인으로 진행합니다. 문의는 010-0000-1234로 부탁드립니다.", []);
assert(smallAssociationAnalysis.info.period === "다음 달에", "정확한 날짜가 없으면 상대 기간을 보존해야 합니다.");
assert(smallAssociationAnalysis.info.benefit === "참가비 없음", "참가비 없음 표현이 혜택으로 정리되어야 합니다.");

console.log("source-analysis-check: 후보 랭킹, 날짜 정규화, 신청 링크 우선, 기간 분리, 이미지 표 다중 프로그램, 기관별 메일 변형 통과");
