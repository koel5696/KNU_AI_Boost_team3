export type ExtractedInfo = {
  title: string;
  category: string;
  description: string;
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

export type SnsPost = {
  title: string;
  body: string;
  hashtags: string;
  copyText: string;
};

export type MessageDraft = {
  title: string;
  body: string;
  copyText: string;
};

const NEEDS_REVIEW = "담당자 확인 필요";
const ENDING_PATTERN = /(합니다|됩니다|주세요|있습니다|바랍니다|부탁드립니다|모집합니다|신청할 수 있습니다|제공됩니다|입니다|이어야 합니다)$/;
const FULL_PHONE_PATTERN = /(?:0[0-9]{1,2})-[0-9]{3,4}-[0-9]{4}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const AUDIENCE_NOUN_PATTERN = /(강남대학교\s*)?(재학생|휴학생|대학생|대학원생|학부생|신입생|졸업생|청년|교직원|지역\s*주민)/g;
const ORGANIZATION_PATTERN = /센터|팀|재단|기관|사무국|운영팀|지원센터|네트워크|연구원|협회|그룹/;
const OMITTED_YEAR_DOTTED_RANGE_PATTERN =
  /(20\d{2})\s*[.]\s*(\d{1,2})\s*[.]\s*(\d{1,2})\s*[.]?\s*(?:\([^)]*\))?\s*~\s*(?:(20\d{2})\s*[.]\s*)?(\d{1,2})\s*[.]\s*(\d{1,2})\s*[.]?/;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]|]+/i;
const ORGANIZER_SUFFIXES =
  "센터|팀|재단|기관|사무국|지원센터|네트워크|연구원|협회|그룹|사업단|클러스터|운영사무국|운영팀";

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

function cleanTitleText(value: string) {
  return value
    .replace(/^제목\s*[:：]\s*/i, "")
    .replace(/[<>「」『』]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTitleLine(text: string) {
  const line = text
    .split(/\n+/)
    .map((item) => item.trim())
    .find((item) =>
      item.length >= 4 &&
      item.length <= 80 &&
      !/^(안녕하세요|감사합니다|문의|채용 관련 문의|연구 분야 관련 문의|신청|접수|지원자|근무 기간)/.test(item) &&
      !/(습니다|됩니다|드립니다|바랍니다|합니다|입니다|주세요)[.!?。]?$/.test(item),
    );
  return line ? cleanTitleText(line) : "";
}

function extractOrganizer(text: string) {
  const suffixGroup = `(?:${ORGANIZER_SUFFIXES})`;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const patterns = [
    new RegExp(`^([가-힣A-Za-z0-9·&()\\s]{2,40}?${suffixGroup})(?:에서는|에서|은|는)`),
    new RegExp(`^안녕하세요[,.]?\\s*([가-힣A-Za-z0-9·&()\\s]{2,40}?${suffixGroup})입니다`),
    new RegExp(`^문의\\s*[:：]?\\s*([가-힣A-Za-z0-9·&()\\s]{2,40}?${suffixGroup})`),
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) return cleanTitleText(match[1]);
    }
  }

  return "";
}

function titleWithOrganizer(title: string, organizer: string) {
  const cleanTitle = cleanTitleText(title);
  const cleanOrganizer = cleanTitleText(organizer);
  if (!cleanTitle) return "";
  if (!cleanOrganizer || cleanTitle.includes(cleanOrganizer) || /^\[[^\]]+\]/.test(cleanTitle)) {
    return cleanTitle;
  }

  const normalizedTitle = /안내$/.test(cleanTitle) ? cleanTitle : `${cleanTitle} 안내`;
  return `[${cleanOrganizer}] ${normalizedTitle}`;
}

function extractTitle(text: string) {
  const title = (
    lineValue(text, ["제목", "Subject"]) ||
    firstMatch(text, [
      /^\s*<\s*([^>\n]{4,80})\s*>/m,
      /^\s*[「『]\s*([^」』\n]{4,80})\s*[」』]/m,
    ]) ||
    firstTitleLine(text)
  );
  return titleWithOrganizer(title, extractOrganizer(text));
}

export function inferCategory(text: string) {
  if (/부스트\s*캠프|부트\s*캠프|boost\s*camp|스프린트|해커톤|AI\s*활용|Codex/i.test(text)) return "AI 교육/부트캠프";
  if (/변경|연장|재안내|수정/.test(text)) return "변경/재안내";
  if (/봉사|자원봉사/.test(text)) return "봉사";
  if (/창업|경진대회|공모전|아이디어|챌린지/.test(text)) return "창업/경진대회";
  if (/토크콘서트|행사|특강|콘서트/.test(text)) return "행사/특강";
  if (/인턴|연구/.test(text)) return "인턴/연구";
  if (/교육|강의|직무|훈련|프로그램/.test(text)) return "교육/직무훈련";
  if (/leadership|program|participants|application|eligibility/i.test(text)) return "모집";
  if (/모집|참가자|신청/.test(text)) return "모집";
  if (/장학|지원금|혜택/.test(text)) return "지원/혜택";
  return "";
}

function sectionValue(text: string, labels: string[]) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = lines[index].replace(/^[■※*\-·•\s]+/, "").trim();
    if (!labels.some((label) => new RegExp(`^${label}\\b`, "i").test(normalizedLine))) continue;

    const values: string[] = [];
    for (let cursor = index + 1; cursor < lines.length && values.length < 5; cursor += 1) {
      const next = lines[cursor].replace(/^[■※*\-·•\s]+/, "").trim();
      if (/^(참여대상|모집 대상|운영기간|세부일정|교육내용|수료기준|참가 신청|신청 방법|문의|행사 개요|일정|참가 혜택|참가 제한)\b/i.test(next)) break;
      if (next) values.push(next);
    }
    if (values.length) return values.join(" ");
  }
  return "";
}

function cleanDescription(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceForNotice(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const labeled = normalized.match(/^(수료기준|참여대상|모집대상|운영기간|교육내용|행사\s*개요|참가\s*혜택)\s+(.+)$/);
  if (labeled) {
    const [, label, body] = labeled;
    if (/수료기준/.test(label)) {
      const requirements = body
        .replace(/\s*(?:및|그리고)\s*/g, ", ")
        .replace(/(출석|이수|완료|제출)\s+([가-힣A-Za-z0-9])/g, "$1, $2")
        .replace(/\s+/g, " ");
      return `수료기준은 ${requirements}해야 합니다.`;
    }
    if (/참여대상|모집대상/.test(label)) {
      return `참여 대상은 ${body}입니다.`;
    }
    if (/운영기간/.test(label)) {
      return `운영기간은 ${body}입니다.`;
    }
    if (/참가\s*혜택/.test(label)) {
      return `참가 혜택은 ${body}입니다.`;
    }
    return `${body.replace(/[.!?。]?$/, "")}.`;
  }
  if (/(습니다|됩니다|드립니다|바랍니다|합니다|입니다|주세요)[.!?。]?$/.test(normalized)) {
    return normalized.replace(/[.!?。]?$/, ".");
  }
  if (/(참여|출석|신청|제출)$/.test(normalized)) {
    return `${normalized}해야 합니다.`;
  }
  if (/(가능|제공|지원|진행|운영|학습|제작|경험)$/.test(normalized)) {
    return `${normalized}합니다.`;
  }
  return `${normalized}입니다.`;
}

function sameNoticeValue(left: string, right: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/https?:\/\//g, "")
      .replace(/[\s/|.,:：()[\]{}'"~-]/g, "")
      .trim();
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function noticeTitle(info: ExtractedInfo) {
  if (info.title) return info.title;
  const category = info.category || "프로그램";
  return `[${category}] 프로그램 안내`;
}

function cleanApplyMethod(value: string) {
  if (!value) return "";
  const link = value.match(URL_PATTERN)?.[0];
  if (link) return link;
  const sentence = value
    .split(/문의|연락|전화|이메일|메일|담당자/)
    .at(0)
    ?.replace(/^(신청은|신청 방법은|신청\s*[:：-]?)/, "")
    .replace(/에서\s*가능하고\s*$/, "")
    .replace(/에서\s*가능하며\s*$/, "")
    .replace(/에서\s*진행됩니다.*$/, "")
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

  if (ORGANIZATION_PATTERN.test(normalized) && !/대상|자격|거주|미취업|학생|재학생|휴학생|국민/.test(normalized)) return "";

  if (/안녕하세요|반갑습니다|초대합니다|여러분/.test(normalized) && !/대상|자격/.test(normalized)) {
    const audienceNouns = [...normalized.matchAll(AUDIENCE_NOUN_PATTERN)]
      .map((match) => `${match[1] ?? ""}${match[2]}`.replace(/\s+/g, " ").trim());
    return audienceNouns.at(-1) ?? "";
  }

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
    .replace(/\s*여러분\s*안녕하세요.*$/, "")
    .replace(/\s*여러분$/, "")
    .trim();

  if (!normalized || ENDING_PATTERN.test(normalized)) return "";
  return normalized;
}

function cleanPeriod(value: string) {
  if (!value) return "";
  if (/되면|마감되면|조기 종료|연장 안내|할 예정입니다/.test(value)) return "";

  const omittedRange = normalizeOmittedYearDottedRange(value);
  const normalized = (omittedRange || value)
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

function normalizeOmittedYearDottedRange(value: string) {
  const match = value.match(OMITTED_YEAR_DOTTED_RANGE_PATTERN);
  if (!match) return "";
  const [, startYear, startMonth, startDay, endYearRaw, endMonth, endDay] = match;
  const endYear = endYearRaw || startYear;
  return `${startYear}-${startMonth.padStart(2, "0")}-${startDay.padStart(2, "0")} ~ ${endYear}-${endMonth.padStart(2, "0")}-${endDay.padStart(2, "0")}`;
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
      /(다음\s*달에?)/,
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
  return value
    .replace(/참가비는\s*없고?/, "참가비 없음")
    .replace(/\s+/g, " ")
    .replace(/\blif\s*:?/gi, "")
    .trim();
}

function extractContact(text: string) {
  const phone = text.match(FULL_PHONE_PATTERN)?.[0];
  const email = text.match(EMAIL_PATTERN)?.[0];
  const extension = text.match(/내선(?:번호)?\s*[:：]?\s*(\d{3,4})/)?.[1];
  const inquiryLine = text.split(/\n+/).find((line) => /문의|contact/i.test(line));
  const link = inquiryLine?.match(URL_PATTERN)?.[0] ?? (/참가\s*신청\s*및\s*문의|신청\s*및\s*문의/.test(text) ? text.match(URL_PATTERN)?.[0] : "");
  return phone || email || (extension ? `내선 ${extension}` : "") || link || "";
}

export function extractInfo(text: string): ExtractedInfo {
  const searchableText = bodyOnly(text);
  const labeledAudience = lineValue(text, ["모집 대상", "참가 대상", "참가 자격", "지원자", "Eligibility"]);
  const labeledBenefit = lineValue(text, ["참가 비용", "참가비", "시상 규모", "주요 혜택", "혜택"]);
  const labeledApplyMethod = lineValue(text, ["신청 방법", "참가 신청 및 문의", "신청 및 문의", "신청", "제출 방법", "신청 페이지"]);
  const description = cleanDescription(
    sectionValue(searchableText, ["교육내용", "행사 개요", "프로그램 내용", "주요 내용"]) ||
      firstMatch(searchableText, [
        /(AI\s*활용[^.\n]*(?:프로그램|제작|학습)[^.\n]*)/,
        /(기초부터\s*프로젝트\s*완성까지[^.\n]*)/,
        /(현직[^.\n]*(?:특강|콘서트|멘토링)[^.\n]*)/,
      ]),
  );

  return {
    title: extractTitle(text),
    category: inferCategory(text),
    description,
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
      /(재맞고\s*20시간\s*인정[^.\n]*)/,
      /(팀[·・ㆍ.]?개인별\s*교육\s*및\s*멘토링\s*제공[^.\n]*)/,
      /(총\s*[0-9,]+\s*만\s*원\s*상당\s*시상품\s*제공[^.\n]*)/,
      /(ChatGPT\s*[+·・ㆍ.]?\s*Codex\s*인당\s*플랜\s*[0-9]+\s*계정\s*제공[^.\n]*)/,
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
      /(참가비는\s*없고?)/,
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
  const description = sentenceForNotice(info.description || `${titleCategory} 프로그램`);
  const period = info.period || NEEDS_REVIEW;
  const benefit = info.benefit || NEEDS_REVIEW;
  const apply = info.applyMethod || NEEDS_REVIEW;
  const contact = info.contact || NEEDS_REVIEW;
  const mergedApplyContact = sameNoticeValue(apply, contact);

  return `${titleAudience} 대상 ${titleCategory} 참가자를 모집합니다.

${description}

기간은 ${period}이며, ${benefit}로 운영됩니다.
${mergedApplyContact
  ? `참여를 희망하거나 문의가 있는 경우 ${apply}을 확인해 주세요.`
  : `참여를 희망하는 분은 ${apply}을 확인해 신청해 주세요.\n자세한 문의는 ${contact}로 연락해 주시기 바랍니다.`}`;
}

export function buildHomepagePost(info: ExtractedInfo): HomepagePost {
  const category = info.category || "일반공지";
  const description = info.description ? sentenceForNotice(info.description) : NEEDS_REVIEW;
  const audience = normalizeAudience(info.audience) || NEEDS_REVIEW;
  const period = info.period || NEEDS_REVIEW;
  const benefit = info.benefit || NEEDS_REVIEW;
  const applyMethod = info.applyMethod || NEEDS_REVIEW;
  const contact = info.contact || NEEDS_REVIEW;
  const title = noticeTitle(info);
  const mergedApplyContact = sameNoticeValue(applyMethod, contact);
  const applyContactSection = mergedApplyContact
    ? `5. 신청 방법 및 문의\n${applyMethod}`
    : `5. 신청 방법\n${applyMethod}\n\n6. 문의\n${contact}`;

  const body = `다음과 같이 ${category} 프로그램을 안내하오니 관심 있는 분들의 많은 참여 바랍니다.

1. 프로그램 개요
${description}

2. 대상
${audience}

3. 기간
${period}

4. 주요 혜택
${benefit}

${applyContactSection}`;

  return {
    title,
    category,
    body,
    copyText: `${title}
분류: ${category}

${body}`,
  };
}

function compactValue(value: string) {
  return value || NEEDS_REVIEW;
}

function hashtagValue(value: string) {
  return value.replace(/[^0-9A-Za-z가-힣]/g, "");
}

function buildNoticeTags(info: ExtractedInfo, organizerName = "") {
  const genericTags = new Set(["공지", "안내", "모집", "프로그램", "행사", "강남대학교"]);
  const candidates = [organizerName, info.category, noticeTitle(info)]
    .map(hashtagValue)
    .filter((tag) => tag.length > 1 && !genericTags.has(tag));

  return [...new Set(candidates)].slice(0, 3);
}

function messageSubject(info: ExtractedInfo) {
  const title = noticeTitle(info).trim();
  if (!title) return info.category || "공지";
  return /안내$/.test(title) ? title : `${title} 안내`;
}

export function buildSnsPost(info: ExtractedInfo, organizerName = ""): SnsPost {
  const title = noticeTitle(info);
  const description = compactValue(sentenceForNotice(info.description));
  const audience = compactValue(normalizeAudience(info.audience));
  const period = compactValue(info.period);
  const benefit = compactValue(info.benefit);
  const applyMethod = compactValue(info.applyMethod);
  const contact = compactValue(info.contact);
  const mergedApplyContact = sameNoticeValue(applyMethod, contact);

  const body = `📢 ${title}

📝 개요: ${description}
🙋 대상: ${audience}
📅 기간: ${period}
🎁 혜택: ${benefit}
${mergedApplyContact ? `✅ 신청 및 문의: ${applyMethod}` : `✅ 신청: ${applyMethod}\n☎️ 문의: ${contact}`}

관심 있는 분들의 많은 참여 바랍니다.`;

  const tags = buildNoticeTags(info, organizerName);
  const hashtags = tags.length ? tags.map((tag) => `#${tag}`).join(" ") : "#공지";

  return {
    title,
    body,
    hashtags,
    copyText: `${body}\n\n${hashtags}`,
  };
}

function messageGreeting(senderName = "") {
  const trimmed = senderName.replace(/\s+/g, " ").trim();
  return trimmed ? `안녕하세요. ${trimmed}입니다.` : "안녕하세요.";
}

export function buildMessageDraft(info: ExtractedInfo, senderName = ""): MessageDraft {
  const organizer = senderName.replace(/\\s+/g, " ").trim();
  const subject = messageSubject(info);
  const description = info.description ? sentenceForNotice(info.description) : NEEDS_REVIEW;
  const audience = normalizeAudience(info.audience) || NEEDS_REVIEW;
  const period = info.period || NEEDS_REVIEW;
  const applyMethod = info.applyMethod || NEEDS_REVIEW;
  const contact = info.contact || NEEDS_REVIEW;
  const mergedApplyContact = sameNoticeValue(applyMethod, contact);

  const body = `${subject}

${messageGreeting(organizer)}

개요: ${description}
대상: ${audience}
기간: ${period}
${mergedApplyContact ? `신청 및 문의: ${applyMethod}` : `신청: ${applyMethod}\n문의: ${contact}`}`;

  return { title: subject, body, copyText: body };
}
