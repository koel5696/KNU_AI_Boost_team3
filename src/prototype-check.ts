import { buildHomepagePost, buildMessageDraft, buildSnsPost, extractInfo, sampleMail } from "./extractor";
import { buildImageDraft } from "./imageDraft";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const normal = extractInfo(sampleMail);
const post = buildHomepagePost(normal);
const snsPost = buildSnsPost(normal);
const messageDraft = buildMessageDraft(normal);
const promotionalImage = buildImageDraft(normal, "SNS", "promotional");
const informationalImage = buildImageDraft(normal, "홈페이지", "informational");

assert(normal.category === "교육/직무훈련", "정상 입력에서 유형 추출 실패");
assert(normal.audience === "19~34세 청년", "정상 입력에서 대상 정리 실패");
assert(normal.period.includes("2026년 8월 14일"), "정상 입력에서 기간 추출 실패");
assert(normal.contact === "02-1234-5678", "정상 입력에서 문의처 추출 실패");
assert(normal.applyMethod === "운영기관 홈페이지", "신청 방법 정리 실패");
assert(post.copyText.includes("제목:") && post.copyText.includes("02-1234-5678"), "홈페이지 게시글 생성 실패");
assert(!post.copyText.includes("신청 방법\n운영기관 홈페이지에서 가능하고 문의"), "신청 방법에 문의처 문장 혼입");
assert(!post.copyText.includes("모집합니다을 대상으로"), "홈페이지 게시글 대상 문장 결합 오류");
assert(!post.copyText.includes("습니다을 대상으로"), "홈페이지 게시글 종결어미 결합 오류");
assert(!post.copyText.includes("참여 대상 대상"), "홈페이지 게시글 제목 대상 중복 오류");
assert(snsPost.copyText.includes("#강남대학교"), "SNS 해시태그 생성 실패");
assert(snsPost.copyText.includes("📅 기간:"), "SNS 채널 형식 생성 실패");
assert(messageDraft.copyText.startsWith("[강남대학교"), "메시지 채널 형식 생성 실패");
assert(messageDraft.copyText.includes("학교 홈페이지 공지"), "메시지 상세 안내 문구 생성 실패");
assert(promotionalImage.title.includes("참여자를 모집"), "홍보용 이미지 제목 생성 실패");
assert(promotionalImage.channelLabel === "SNS", "이미지 채널 정보 반영 실패");
assert(informationalImage.title.includes("프로그램 안내"), "안내용 이미지 제목 생성 실패");
assert(informationalImage.contact === "02-1234-5678", "이미지 문의처 반영 실패");

const emptyMessage =
  "메일 내용을 입력해 주세요. 공유 메일 본문이나 제목을 붙여넣으면 예시 추출 결과를 만들 수 있습니다.";
assert(emptyMessage.includes("메일 내용을 입력"), "빈 입력 안내 문구 확인 실패");

const regenerated = buildHomepagePost(extractInfo(sampleMail));
assert(regenerated.copyText === post.copyText, "다시 입력 후 재생성 흐름 확인 실패");
assert(post.copyText.length > 0, "복사 대상 게시글 없음");

const startupCompetitionMail = `안녕하세요. 미래창업지원센터입니다.
대학생의 창의적인 창업 아이디어 발굴을 위한 ‘2026 대학생 창업 아이디어 경진대회’ 참가팀을 모집합니다.
전국 대학 재학생 및 휴학생으로 구성된 2~4인 팀이라면 신청할 수 있습니다.
참가를 희망하는 팀은 2026년 9월 5일까지 참가 신청서와 아이디어 기획서를 운영기관 홈페이지에 제출해 주세요.
대상 팀에는 상금 300만 원과 창업 전문가 멘토링 기회가 제공됩니다.
자세한 사항은 미래창업지원센터(02-9876-5432)로 문의해 주세요.`;

const competition = extractInfo(startupCompetitionMail);
const competitionPost = buildHomepagePost(competition);

assert(competition.category, "창업 경진대회 입력에서 유형 추출 실패");
assert(competition.audience === "전국 대학 재학생 및 휴학생으로 구성된 2~4인 팀", "창업 경진대회 입력에서 대상 정리 실패");
assert(competition.period.includes("2026년 9월 5일"), "창업 경진대회 입력에서 기간 추출 실패");
assert(competition.benefit.includes("상금") || competition.benefit.includes("멘토링"), "창업 경진대회 입력에서 혜택 추출 실패");
assert(competition.applyMethod === "운영기관 홈페이지", "창업 경진대회 입력에서 신청 방법 정리 실패");
assert(competition.contact === "02-9876-5432", "창업 경진대회 입력에서 문의처 추출 실패");
assert(competitionPost.copyText.includes("제목:"), "창업 경진대회 홈페이지 게시글 생성 실패");
assert(!competitionPost.copyText.includes("있습니다을 대상으로"), "창업 경진대회 게시글 대상 문장 결합 오류");
assert(!competitionPost.copyText.includes("참여 대상 대상"), "창업 경진대회 게시글 제목 대상 중복 오류");

const researchInternMail = `제목: 2026 하반기 연구인턴 공개모집

국가미래기술연구원에서는 다음과 같이 연구인턴을 공개 모집합니다.

지원자는 국내외 대학의 이공계 학부 3학년 이상 재학생 또는 석사과정 재학생이어야 합니다. 졸업생과 수료생은 지원 대상에서 제외됩니다.

근무 기간은 2026년 9월 14일부터 12월 18일까지이며, 주 5일 전일제 근무가 가능해야 합니다. 월 210만 원의 연구활동비를 지급합니다.

접수는 2026.08.03. 09:00부터 2026.08.21. 17:00까지 채용 홈페이지에서 진행됩니다.

채용 관련 문의: example@nfit.re.kr
연구 분야 관련 문의: 첨부파일의 부서별 연락처 참고.`;

const research = extractInfo(researchInternMail);
assert(research.period === "2026.08.03. 09:00부터 2026.08.21. 17:00까지", "연구인턴 입력에서 접수 기간 우선 추출 실패");
assert(!research.period.includes("9월 14일"), "연구인턴 입력에서 근무 기간을 기간으로 잘못 추출");

console.log("prototype-check: 정상 입력, 빈 입력 안내, 다시 입력/복사 대상 확인 통과");
