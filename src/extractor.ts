export type ExtractedInfo = {
  category: string;
  audience: string;
  period: string;
  benefit: string;
  applyMethod: string;
  contact: string;
};

export type HomepagePost = {
  title: string;
  category: string;
  body: string;
  copyText: string;
};

const NEEDS_REVIEW = "담당자 확인 필요";
const ENDING_PATTERN = /(합니다|됩니다|주세요|있습니다|바랍니다|부탁드립니다|모집합니다|신청할 수 있습니다|제공됩니다|입니다|이어야 합니다)$/;
const FULL_PHONE_PATTERN = /(?:0[0-9]{1,2})-[0-9]{3,4}-[0-9]{4}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export const sampleMail = `제목: 청년 대상 AI 직무교육 참가자 모집

안녕하세요. 공유드립니다.
19~34세 청년을 대상으로 AI 직무교육 참가자를 모집합니다.
신청 마감은 2026년 8월 14일까지이며, 교육비는 전액 무료입니다.
신청은 운영기관 홈페이지에서 가능하고 문의는 02-1234-5678로 부탁드립니다.
홍보가 필요하니 홈페이지 공지로 게시 검토 부탁드립니다.`;

export function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function lineValue(text: string, labels: string[]) {
  const lines = text.split(/\n+/).map((line) => line.trim());
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`^(?:[가-힣]\\.\\s*)?${label}\\s*[:：]\\s*(.+)$`, "i");
      const match = line.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }
  return "";
}

function bodyOnly(text: string) {
  return text
    .split(/\n+/)
    .filter((line) => !/^\s*(제목|Subject)\s*[:：]/i.test(line))
    .join("\n");
}

export function inferCategory(text: string) {
  if (/변경|연장|재안내|수정/.test(text)) return "변경/재안내";
  if (/봉사|자원봉사/.test(text)) return "봉사";
  if (/창업|경진대회|공모전|아이디어|챌린지/.test(text)) return "창업/경진대회";
  if (/토크콘서트|행사|특강|콘서트/.test(text)) return "행사/특강";
  if (/인턴|연구/.test(text)) return "인턴/연구";
  if (/교육|강의|직무|훈련|프로그램/.test(text)) return "교육/직무훈련";
  if (/모집|참가자|신청/.test(text)) return "모집";
  if (/장학|지원금|혜택/.test(text)) return "지원/혜택";
  return "";
}

function cleanApplyMethod(value: string) {
  if (!value) return "";
  const sentence = value
    .split(/문의|연락|전화|이메일|메일|담당자/)
    .at(0)
    ?.replace(/^(신청은|신청 방법은|신청\s*[:：-]?)/, "")
    .replace(/에서\s*가능하고\s*$/, "")
    .replace(/에서\s*가능하며\s*$/, "")
    .replace(/에\s*제출해\s*주세요\s*$/, "")
    .replace(/해\s*주세요\s*$/, "")
    .replace(/고\s*$/, "")
    .trim();

  if (!sentence || sentence.length < 4 || ENDING_PATTERN.test(sentence)) return "";
  return sentence;
}

function normalizeAudience(value: string) {
  if (!value) return "";
  let normalized = value
    .replace(/[,，]\s*$/, "")
    .replace(/[.。]\s*$/, "")
    .trim();

  normalized = normalized
    .replace(/을\s*대상으로.*$/, "")
    .replace(/를\s*대상으로.*$/, "")
    .replace(/대상으로.*$/, "")
    .replace(/은\s*멘티로.*$/, "")
    .replace(/는\s*멘티로.*$/, "")
    .replace(/이라면\s*신청할\s*수\s*있습니다.*$/, "")
    .replace(/라면\s*신청할\s*수\s*있습니다.*$/, "")
    .replace(/이\s*신청할\s*수\s*있습니다.*$/, "")
    .replace(/가\s*신청할\s*수\s*있습니다.*$/, "")
    .replace(/이어야\s*합니다.*$/, "")
    .replace(/참가자를\s*모집합니다.*$/, "")
    .replace(/참가팀을\s*모집합니다.*$/, "")
    .replace(/모집합니다.*$/, "")
    .trim();

  if (!normalized || ENDING_PATTERN.test(normalized)) return "";
  return normalized;
}

function cleanPeriod(value: string) {
  if (!value) return "";
  if (/되면|마감되면|조기 종료|연장 안내|할 예정입니다/.test(value)) return "";

  const normalized = value
    .replace(/^(마감|모집 마감|변경 마감일|교육 기간|프로그램 기간|활동 기간|근무 기간|접수 기간|일시|접수는|Program Period|Application Deadline)\s*[:：]?\s*/i, "")
    .replace(/^서류\s*접수는\s*/, "")
    .replace(/^은\s*/, "")
    .replace(/^는\s*/, "")
    .replace(/^활동은\s*/, "")
    .replace(/입니다\s*$/, "")
    .replace(/이며.*$/, "")
    .replace(/매주.*$/, "")
    .trim();
  if (/되면|마감되면|조기 종료|연장 안내|할 예정|진행됩니다|진행되며/.test(normalized)) return "";
  return normalized;
}

function extractPeriod(text: string) {
  const applicationPeriod =
    lineValue(text, ["접수 기간", "신청 기간", "모집 기간", "모집 마감", "서류 접수", "Application Deadline", "접수는", "접수"]) ||
    firstMatch(text, [
      /(접수는\s*20[0-9]{2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}:[0-9]{2}부터\s*20[0-9]{2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}:[0-9]{2}까지)/,
      /(서류\s*접수는\s*[0-9]{1,2}월\s*[0-9]{1,2}일\s*자정까지)/,
      /(접수\s*기간은\s*20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일부터\s*[0-9]{1,2}월\s*[0-9]{1,2}일까지)/,
      /(접수\s*기간\s*[:：]\s*20[0-9]{2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.\s*~?\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.?)/,
      /(신청\s*기간[^.\n]*)/,
      /(접수\s*기간[^.\n]*)/,
      /(모집\s*마감\s*[:：]\s*20[0-9]{2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.\([^)]*\)\s*[0-9]{1,2}:[0-9]{2})/,
      /(변경\s*마감일\s*[:：]\s*20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일[^.\n]*)/,
      /(20[0-9]{2}[년.-]\s*[0-9]{1,2}[월.-]\s*[0-9]{1,2}일?까지?)/,
      /([0-9]{1,2}월\s*[0-9]{1,2}일까지)/,
      /(August\s*[0-9]{1,2},\s*20[0-9]{2}[^.\n]*)/,
    ]);

  if (applicationPeriod) return cleanPeriod(applicationPeriod);

  return cleanPeriod(
    lineValue(text, ["교육 기간", "프로그램 기간", "활동 기간", "일시", "Program Period"]) ||
      firstMatch(text, [
        /(활동은\s*20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일부터\s*[0-9]{1,2}월\s*[0-9]{1,2}일까지[^.\n]*)/,
        /(20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일부터\s*12월\s*[0-9]{1,2}일까지[^.\n]*)/,
        /(20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일부터\s*[0-9]{1,2}월\s*[0-9]{1,2}일까지[^.\n]*)/,
        /(20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일부터\s*20[0-9]{2}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일까지[^.\n]*)/,
        /(20[0-9]{2}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.\s*~?\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.?)/,
      ]),
  );
}

function cleanBenefit(value: string) {
  if (!value) return "";
  if (/지원할|지원자는|모집합니다|참가자 모집/.test(value)) return "";
  return value.trim();
}

function extractContact(text: string) {
  const phone = text.match(FULL_PHONE_PATTERN)?.[0];
  const email = text.match(EMAIL_PATTERN)?.[0];
  return phone || email || "";
}

export function extractInfo(text: string): ExtractedInfo {
  const searchableText = bodyOnly(text);
  const labeledAudience = lineValue(text, ["모집 대상", "참가 대상", "참가 자격", "지원자", "Eligibility"]);
  const labeledBenefit = lineValue(text, ["참가 비용", "참가비", "시상 규모", "주요 혜택", "혜택"]);
  const labeledApplyMethod = lineValue(text, ["신청 방법", "신청", "제출 방법", "신청 페이지"]);

  return {
    category: inferCategory(text),
    audience: normalizeAudience(labeledAudience || firstMatch(searchableText, [
      /(서울\s*거주\s*만\s*[0-9]{1,2}세\s*[~-]\s*[0-9]{1,2}세\s*[^.\n,]*)/,
      /(전국\s*대학생)/,
      /([0-9]{1,2}\s*[~-]\s*[0-9]{1,2}세\s*[^.\n,]*)/,
      /(전국\s*대학\s*재학생\s*및\s*휴학생[^.\n,]*)/,
      /(전공\s*과목\s*학습에\s*어려움을\s*겪는\s*재학생[^.\n,]*)/,
      /(재학생\s*및\s*휴학생[^.\n,]*)/,
      /(수도권\s*소재\s*대학의\s*재학생\s*또는\s*휴학생[^.\n,]*)/,
      /(콘텐츠\s*분야\s*취업을\s*준비하는\s*학생들)/,
      /(개발\s*직무에\s*관심\s*있는\s*대학생\s*및\s*취업준비생)/,
      /(국내외\s*대학의\s*이공계\s*학부\s*3학년\s*이상\s*재학생\s*또는\s*석사과정\s*재학생[^.\n,]*)/,
      /(Undergraduate students aged 18[-–][0-9]{1,2})/,
      /([0-9]\s*[~-]\s*[0-9]인\s*팀[^.\n,]*)/,
      /([0-9]\s*[~-]\s*[0-9]인\s*팀이라면[^.\n,]*)/,
      /(청년[^.\n,]*)/,
      /(대학생[^.\n,]*)/,
      /(재학생[^.\n,]*)/,
    ])),
    period: extractPeriod(searchableText),
    benefit: cleanBenefit(labeledBenefit || firstMatch(searchableText, [
      /(상금[^.\n]*)/,
      /(총상금[^.\n]*)/,
      /(장학금\s*[0-9,]+\s*만\s*원[^.\n]*)/,
      /(월\s*[0-9,]+\s*만\s*원의\s*연구활동비[^.\n]*)/,
      /(봉사시간\s*인증서[^.\n]*)/,
      /(accommodation[^.\n]*)/,
      /(멘토링[^.\n]*)/,
      /(전액\s*무료)/,
      /(무료)/,
      /(무료[^.\n]*)/,
      /(지원[^.\n]*)/,
      /(혜택[^.\n]*)/,
    ])),
    applyMethod: cleanApplyMethod(labeledApplyMethod || firstMatch(searchableText, [
      /(운영기관\s*홈페이지[^.\n]*)/,
      /(센터\s*홈페이지\s*온라인\s*신청)/,
      /(학생지원시스템[^.\n]*)/,
      /(채용\s*홈페이지[^.\n]*)/,
      /(구글폼\s*작성)/,
      /(담당자\s*이메일\s*접수)/,
      /(재단\s*홈페이지에서\s*지원서\s*내려받기)/,
      /(아래\s*링크[^.\n]*)/,
      /(아래\s*폼[^.\n]*)/,
      /(online application form[^.\n]*)/,
      /(홈페이지[^.\n]*)/,
      /(온라인[^.\n]*)/,
      /(신청[^.\n]*)/,
    ])),
    contact: extractContact(text),
  };
}

export function buildDraft(info: ExtractedInfo) {
  const titleAudience = info.audience || "관심 있는 학생 및 지역 청년";
  const titleCategory = info.category || "프로그램";
  const period = info.period || NEEDS_REVIEW;
  const benefit = info.benefit || NEEDS_REVIEW;
  const apply = info.applyMethod || NEEDS_REVIEW;
  const contact = info.contact || NEEDS_REVIEW;

  return `${titleAudience} 대상 ${titleCategory} 참가자를 모집합니다.

기간은 ${period}이며, ${benefit}로 운영됩니다.
참여를 희망하는 분은 ${apply}을 확인해 신청해 주세요.
자세한 문의는 ${contact}로 연락해 주시기 바랍니다.`;
}

export function buildHomepagePost(info: ExtractedInfo): HomepagePost {
  const category = info.category || "일반공지";
  const audience = normalizeAudience(info.audience) || NEEDS_REVIEW;
  const period = info.period || NEEDS_REVIEW;
  const benefit = info.benefit || NEEDS_REVIEW;
  const applyMethod = info.applyMethod || NEEDS_REVIEW;
  const contact = info.contact || NEEDS_REVIEW;
  const title = audience === NEEDS_REVIEW
    ? `[${category}] 프로그램 안내`
    : `[${category}] ${audience} 대상 프로그램 안내`;

  const body = `안녕하세요.

다음과 같이 ${category} 프로그램을 안내하오니 관심 있는 분들의 많은 참여 바랍니다.

1. 대상
${audience}

2. 기간
${period}

3. 주요 혜택
${benefit}

4. 신청 방법
${applyMethod}

5. 문의
${contact}

※ 본 공지는 공유 메일을 바탕으로 정리한 예시 초안입니다. 게시 전 원문과 필수 항목을 반드시 확인해 주세요.`;

  return {
    title,
    category,
    body,
    copyText: `제목: ${title}
분류: ${category}

${body}`,
  };
}
