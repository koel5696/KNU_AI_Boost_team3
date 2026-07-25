import { buildHomepagePost, buildMessageDraft, buildSnsPost, extractInfo, sampleMail } from "./extractor";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const normal = extractInfo(sampleMail);
const post = buildHomepagePost(normal);
const messageWithSender = buildMessageDraft(normal, "학생지원팀");

assert(!post.body.startsWith("안녕하세요"), "홈페이지 초안에는 첫 인사말이 들어가면 안 됩니다.");
assert(messageWithSender.copyText.includes("\n\n안녕하세요. 학생지원팀입니다.\n\n개요:"), "문자 초안에는 제목 뒤에 발신 소속 인사가 반영되어야 합니다.");
assert(!messageWithSender.copyText.split("\n")[0].includes("학생지원팀"), "문자 제목에는 발신 소속이 섞이면 안 됩니다.");
assert(!messageWithSender.copyText.startsWith("안녕하세요."), "문자 초안은 제목 블록보다 인사가 먼저 나오면 안 됩니다.");
assert(!messageWithSender.copyText.includes("※ 자세한 내용은 학교 홈페이지 공지를 확인해 주세요."), "문자 초안에는 홈페이지 확인 안내 문구가 들어가면 안 됩니다.");

assert(normal.category === "교육/직무훈련", "정상 입력에서 유형 추출 실패");
assert(normal.audience === "19~34세 청년", "정상 입력에서 대상 정리 실패");
assert(normal.period.includes("2026년 8월 14일"), "정상 입력에서 기간 추출 실패");
assert(normal.contact === "02-1234-5678", "정상 입력에서 문의처 추출 실패");
assert(normal.applyMethod === "운영기관 홈페이지", "신청 방법 정리 실패");
assert(post.copyText.startsWith(post.title) && !post.copyText.includes("제목:"), "홈페이지 게시글에는 제목 라벨 없이 제목만 보여야 합니다.");
assert(post.copyText.includes("02-1234-5678"), "홈페이지 게시글 생성 실패");
assert(!post.copyText.includes("신청 방법\n운영기관 홈페이지에서 가능하고 문의"), "신청 방법에 문의처 문장 혼입");
assert(!post.copyText.includes("모집합니다을 대상으로"), "홈페이지 게시글 대상 문장 결합 오류");
assert(!post.copyText.includes("습니다을 대상으로"), "홈페이지 게시글 종결어미 결합 오류");
assert(!post.copyText.includes("참여 대상 대상"), "홈페이지 게시글 제목 대상 중복 오류");
assert(!post.title.includes(normal.audience), "홈페이지 게시글 제목에 대상 조건이 섞이면 안 됩니다.");

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
assert(competitionPost.copyText.startsWith(competitionPost.title) && !competitionPost.copyText.includes("제목:"), "창업 경진대회 홈페이지 게시글에는 제목 라벨이 들어가면 안 됩니다.");
assert(!competitionPost.copyText.includes("있습니다을 대상으로"), "창업 경진대회 게시글 대상 문장 결합 오류");
assert(!competitionPost.copyText.includes("참여 대상 대상"), "창업 경진대회 게시글 제목 대상 중복 오류");
assert(!competitionPost.title.includes("2~4인"), "홈페이지 게시글 제목에 선발 조건이 섞이면 안 됩니다.");

const researchInternMail = `제목: 2026 하반기 연구인턴 공개모집

국가미래기술연구원에서는 다음과 같이 연구인턴을 공개 모집합니다.

지원자는 국내외 대학의 이공계 학부 3학년 이상 재학생 또는 석사과정 재학생이어야 합니다. 졸업생과 수료생은 지원 대상에서 제외됩니다.

근무 기간은 2026년 9월 14일부터 12월 18일까지이며, 주 5일 전일제 근무가 가능해야 합니다. 월 210만 원의 연구활동비를 지급합니다.

접수는 2026.08.03. 09:00부터 2026.08.21. 17:00까지 채용 홈페이지에서 진행됩니다.

채용 관련 문의: example@nfit.re.kr
연구 분야 관련 문의: 첨부파일의 부서별 연락처 참고.`;

const research = extractInfo(researchInternMail);
const researchTitle = "[국가미래기술연구원] 2026 하반기 연구인턴 공개모집 안내";
const researchHomepagePost = buildHomepagePost(research);
const researchSnsPost = buildSnsPost(research);
const researchMessageDraft = buildMessageDraft(research, "교무팀");
assert(research.title === researchTitle, "본문의 주관 기관과 명시 제목을 조합해 공지 제목을 만들어야 합니다.");
assert(researchHomepagePost.title === researchTitle, "홈페이지 초안 제목은 주관 기관과 핵심 제목 구조를 유지해야 합니다.");
assert(researchSnsPost.title === researchTitle, "SNS 초안 제목은 주관 기관과 핵심 제목 구조를 유지해야 합니다.");
assert(researchMessageDraft.copyText.startsWith(`${researchTitle}\n\n안녕하세요. 교무팀입니다.`), "문자 초안 제목도 발신 소속이 아닌 공지 주체와 핵심 제목을 사용해야 합니다.");
assert(research.period === "2026.08.03. 09:00부터 2026.08.21. 17:00까지", "연구인턴 입력에서 접수 기간 우선 추출 실패");
assert(!research.period.includes("9월 14일"), "연구인턴 입력에서 근무 기간을 기간으로 잘못 추출");

const plainResearch = extractInfo(`2026 하반기 연구인턴 공개모집

국가미래기술연구원에서는 다음과 같이 연구인턴을 공개 모집합니다.

지원자는 국내외 대학의 이공계 학부 3학년 이상 재학생 또는 석사과정 재학생이어야 합니다.

접수는 2026.08.03. 09:00부터 2026.08.21. 17:00까지 채용 홈페이지에서 진행됩니다.

채용 관련 문의: recruit@nfit.re.kr`);
assert(plainResearch.title === researchTitle, "제목 라벨이 없어도 첫 핵심 제목과 주관 기관을 조합해야 합니다.");

const careerTalk = extractInfo(`제목: 개발자 진로 토크콘서트 참가 신청 안내

안녕하세요. 커리어브릿지 운영사무국입니다.

현직 개발자 4인과 함께하는 온라인 진로 토크콘서트를 개최합니다.

일시: 2026년 8월 27일 목요일 오후 7시
진행 방식: 실시간 온라인
참가 대상: 개발 직무에 관심 있는 대학생 및 취업준비생
주요 내용: 개발 직무 소개, 취업 준비 방법, 현직자 질의응답
참가비: 무료
신청: 구글폼 작성
모집 인원: 선착순 200명

문의: careerbridge@example.org`);
const careerTalkTitle = "[커리어브릿지] 개발자 진로 토크콘서트 참가 신청 안내";
assert(careerTalk.title === careerTalkTitle, "운영사무국 같은 실무 부서명은 제목 대괄호에서 핵심 주체명으로 정리되어야 합니다.");
assert(buildHomepagePost(careerTalk).title === careerTalkTitle, "홈페이지 초안 제목은 행사 주체와 핵심 제목 구조를 유지해야 합니다.");
assert(buildSnsPost(careerTalk).title === careerTalkTitle, "SNS 초안 제목은 행사 주체와 핵심 제목 구조를 유지해야 합니다.");
assert(buildMessageDraft(careerTalk).copyText.startsWith(careerTalkTitle), "문자 초안 제목도 행사 주체와 핵심 제목 구조를 유지해야 합니다.");

const sameApplyContact = buildHomepagePost({
  title: "",
  category: "AI 교육/부트캠프",
  description: "전공과 관계없이 누구나 참여 가능한 AI 활용 문제해결 및 제품 제작 프로그램",
  audience: "강남대학교 재학생 30명 선발",
  period: "2026-07-13 ~ 2026-07-25",
  benefit: "교육 및 멘토링 제공",
  applyMethod: "https://ai-boost.gdg-kangnam.site",
  contact: "https://ai-boost.gdg-kangnam.site",
});
assert(sameApplyContact.title === "[AI 교육/부트캠프] 프로그램 안내", "제목은 핵심 유형만 간결하게 사용해야 합니다.");
assert(sameApplyContact.copyText.includes("5. 신청 방법 및 문의\nhttps://ai-boost.gdg-kangnam.site"), "동일한 신청/문의 값은 초안에서 합쳐져야 합니다.");
assert(!sameApplyContact.copyText.includes("6. 문의\nhttps://ai-boost.gdg-kangnam.site"), "동일한 신청/문의 값이 중복 출력되면 안 됩니다.");
assert(sameApplyContact.copyText.includes("제품 제작 프로그램입니다."), "프로그램 설명은 공지 문체의 문장으로 끝나야 합니다.");

const explicitTitlePost = buildHomepagePost(extractInfo(`<2026 강냉 AI 부스트캠프>

■ 교육내용
AI 활용 문제해결 및 제품 제작 프로그램입니다.

■ 참가 신청 및 문의
https://ai-boost.gdg-kangnam.site`));
assert(explicitTitlePost.title === "2026 강냉 AI 부스트캠프", "명시된 원문 제목은 공지 제목에 우선 반영되어야 합니다.");

const criteriaPost = buildHomepagePost({
  title: "수료 기준 테스트",
  category: "교육/직무훈련",
  description: "수료기준 온라인 교육 70% 이상 출석 경진대회 당일 참여",
  audience: "재학생",
  period: "2026-07-13 ~ 2026-07-25",
  benefit: "교육 제공",
  applyMethod: "홈페이지 신청",
  contact: "운영팀 문의",
});
assert(criteriaPost.copyText.includes("수료기준은 온라인 교육 70% 이상 출석, 경진대회 당일 참여해야 합니다."), "라벨 문맥이 있는 설명은 자연스러운 공지 문장으로 정리되어야 합니다.");

console.log("prototype-check: 정상 입력, 빈 입력 안내, 다시 입력/복사 대상 확인 통과");
