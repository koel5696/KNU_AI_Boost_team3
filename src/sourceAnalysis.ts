import { extractInfo, type ExtractedInfo } from "./extractor";
import type { ProcessedSource } from "./documentProcessor";

export type ExtractedKey = keyof ExtractedInfo;

export type FieldCandidate = {
  value: string;
  sourceId: string;
  sourceName: string;
  page?: number;
  evidence: string;
  confidence: number;
  isOcr: boolean;
};

export type DetailedField = {
  key: ExtractedKey;
  label: string;
  value: string;
  confidence: number;
  sourceName: string;
  page?: number;
  evidence: string;
  candidates: FieldCandidate[];
  hasConflict: boolean;
};

export type AnalysisResult = {
  info: ExtractedInfo;
  fields: DetailedField[];
  conflicts: DetailedField[];
  links: string[];
  qrCodes: string[];
};

type SourceContext = {
  source: ProcessedSource;
  lines: string[];
};

type PeriodCandidate = FieldCandidate & {
  periodKind: "application" | "event" | "unknown";
};

export const fieldLabels: Record<ExtractedKey, string> = {
  title: "제목",
  category: "유형",
  description: "프로그램 설명",
  audience: "대상",
  period: "기간",
  benefit: "주요 혜택",
  applyMethod: "신청 방법",
  contact: "문의처",
};

const keys = Object.keys(fieldLabels) as ExtractedKey[];
const NEEDS_REVIEW = "담당자 확인 필요";
const GENERIC_EVIDENCE = "규칙 기반으로 문서에서 감지됨";
const URL_PATTERN = /https?:\/\/[^\s<>"')\]|]+/gi;
const SINGLE_URL_PATTERN = /https?:\/\/[^\s<>"')\]|]+/i;
const PHONE_PATTERN = /0\d{1,2}-\d{3,4}-\d{4}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const AUDIENCE_NOUN_PATTERN = /(강남대학교\s*)?(재학생|휴학생|대학생|대학원생|학부생|신입생|졸업생|청년|교직원|지역\s*주민)/g;
const ORGANIZATION_PATTERN = /센터|팀|재단|기관|사무국|운영팀|지원센터|네트워크|연구원|협회|그룹/;
const DATE_TOKEN_PATTERN =
  /(?:20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}(?:\s*\d{1,2}:\d{2})?|20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\s*\d{1,2}:\d{2})?|\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\s*\d{1,2}:\d{2})?)/g;
const OMITTED_YEAR_DOTTED_RANGE_PATTERN =
  /(20\d{2})\s*[.]\s*(\d{1,2})\s*[.]\s*(\d{1,2})\s*[.]?\s*(?:\([^)]*\))?\s*~\s*(?:(20\d{2})\s*[.]\s*)?(\d{1,2})\s*[.]\s*(\d{1,2})\s*[.]?/;
const ENGLISH_DATE_RANGE_PATTERN =
  /([A-Z][a-z]+\s+\d{1,2})\s*[–-]\s*(\d{1,2}),\s*(20\d{2})(?:,\s*[^.\n]*)?/;

const labelHints: Record<ExtractedKey, string[]> = {
  title: ["제목", "Subject"],
  category: ["유형", "분류", "카테고리"],
  description: ["프로그램 설명", "교육내용", "행사 개요", "프로그램 내용", "주요 내용"],
  audience: ["모집 대상", "참가 대상", "지원 대상", "지원 자격", "대상", "Eligibility"],
  period: [
    "신청 기간",
    "접수 기간",
    "모집 기간",
    "모집 마감",
    "행사 일시",
    "교육 기간",
    "운영 기간",
    "활동 기간",
    "일시",
    "기간",
    "Program Period",
    "Application Deadline",
  ],
  benefit: ["주요 혜택", "혜택", "참가 비용", "참가비", "지원 내용", "시상", "상금"],
  applyMethod: ["신청 방법", "접수 방법", "제출 방법", "지원 방법", "참가 신청 및 문의", "신청 및 문의", "신청 링크", "신청", "Apply"],
  contact: ["문의", "문의처", "참가 신청 및 문의", "신청 및 문의", "담당자", "연락처", "전화", "내선번호", "내선", "Contact"],
};

function normalizeCandidate(value: string) {
  return normalizeDatePhrase(value)
    .toLowerCase()
    .replace(/[\s.,:：()[\]{}'"~-]/g, "")
    .replace(/까지|부터|에서|으로|및|또는/g, "");
}

function linesOf(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function meaningfulWords(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word.replace(/[^0-9A-Za-z가-힣@./:-]/g, ""))
    .filter((word) => word.length >= 2);
}

function cleanAudienceValue(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (ORGANIZATION_PATTERN.test(compact) && !/대상|자격|거주|미취업|학생|재학생|휴학생|국민/.test(compact)) return "";
  if (/안녕하세요|반갑습니다|초대합니다|여러분/.test(compact) && !/대상|자격/.test(compact)) {
    const audienceNouns = [...compact.matchAll(AUDIENCE_NOUN_PATTERN)]
      .map((match) => `${match[1] ?? ""}${match[2]}`.replace(/\s+/g, " ").trim());
    return audienceNouns.at(-1) ?? "";
  }

  return compact
    .replace(/\s*여러분\s*안녕하세요.*$/, "")
    .replace(/\s*여러분$/, "")
    .replace(/을\s*대상으로.*$/, "")
    .replace(/를\s*대상으로.*$/, "")
    .replace(/대상으로.*$/, "")
    .replace(/참가자를\s*모집합니다.*$/, "")
    .replace(/모집합니다.*$/, "")
    .trim();
}

function cleanDescriptionValue(value: string) {
  const compact = value
    .replace(/\s+/g, " ")
    .replace(/^[^0-9A-Za-z가-힣]+/, "")
    .trim();
  if (!compact || compact.length < 8) return "";
  return compact;
}

function cleanBenefitValue(value: string) {
  return value
    .split(/\s*(?:참가 제한|모집 대상|일정|신청 QR|참가 신청|문의)\s*/)[0]
    .replace(/(?:^|\s)lif\s*[:：]?/gi, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanContactValue(value: string) {
  const phone = value.match(PHONE_PATTERN)?.[0];
  if (phone) return phone;
  const email = value.match(EMAIL_PATTERN)?.[0];
  if (email) return email;
  const extension = value.match(/내선(?:번호)?\s*[:：]?\s*(\d{3,4})/)?.[1];
  if (extension) return `내선 ${extension}`;
  const link = value.match(SINGLE_URL_PATTERN)?.[0];
  if (link) return link;
  return "";
}

function cleanEvidenceForDisplay(key: ExtractedKey, value: string, evidence: string) {
  if (key === "contact") {
    const phone = value.match(PHONE_PATTERN)?.[0] ?? evidence.match(PHONE_PATTERN)?.[0];
    if (phone) return `문의: ${phone}`;
    const email = value.match(EMAIL_PATTERN)?.[0] ?? evidence.match(EMAIL_PATTERN)?.[0];
    if (email) return `문의: ${email}`;
    const extension = value.match(/내선\s*(\d{3,4})/)?.[1] ?? evidence.match(/내선(?:번호)?\s*[:：]?\s*(\d{3,4})/)?.[1];
    if (extension) return `문의: 내선 ${extension}`;
    const link = value.match(SINGLE_URL_PATTERN)?.[0] ?? evidence.match(SINGLE_URL_PATTERN)?.[0];
    if (link) return `문의 링크: ${link}`;
  }
  if (key === "audience") {
    const audience = cleanAudienceValue(value || evidence);
    if (audience && /안녕하세요|반갑습니다|초대합니다/.test(evidence)) return `대상: ${audience}`;
  }
  if (key === "benefit") {
    return cleanBenefitValue(evidence || value);
  }
  if (key === "category") {
    return value;
  }
  return evidence;
}

function findEvidence(lines: string[], value: string) {
  const direct = lines.find((line) => line.includes(value) || value.includes(line.replace(/[.。]$/, "")));
  if (direct) return direct;

  const normalizedValue = normalizeCandidate(value);
  const normalizedDirect = lines.find((line) => {
    const normalizedLine = normalizeCandidate(line);
    return normalizedLine.includes(normalizedValue) || normalizedValue.includes(normalizedLine);
  });
  if (normalizedDirect) return normalizedDirect;

  const words = meaningfulWords(value);
  let best = "";
  let bestScore = 0;
  for (const line of lines) {
    const score = words.filter((word) => line.includes(word)).length;
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : GENERIC_EVIDENCE;
}

function categoryEvidence(lines: string[], category: string) {
  const contentLines = lines.filter((line) => !/^\s*(?:제목|Subject)\s*[:：]/i.test(line) && !/^\s*[<「『]/.test(line));
  const categoryPatterns: Array<[RegExp, Array<[RegExp, number]>]> = [
    [/AI 교육|부트캠프/i, [[/AI\s*활용|Codex|부스트\s*캠프|부트\s*캠프/i, 4], [/해커톤/i, 3], [/스프린트/i, 1]]],
    [/변경|재안내/i, [[/변경|연장|재안내|수정/i, 3]]],
    [/봉사/i, [[/봉사|자원봉사/i, 3]]],
    [/창업|경진대회/i, [[/창업|경진대회|공모전|아이디어|챌린지/i, 3]]],
    [/행사|특강/i, [[/토크콘서트|행사|특강|콘서트/i, 3]]],
    [/인턴|연구/i, [[/인턴|연구/i, 3]]],
    [/교육|직무훈련/i, [[/교육|강의|직무|훈련|프로그램/i, 3]]],
    [/모집/i, [[/모집|참가자|신청|participants|application|eligibility/i, 2]]],
    [/지원|혜택/i, [[/장학|지원금|혜택/i, 3]]],
  ];
  const patterns = categoryPatterns.find(([categoryPattern]) => categoryPattern.test(category))?.[1];
  if (patterns) {
    let best = "";
    let bestScore = 0;
    for (const line of contentLines) {
      const score = patterns.reduce((sum, [pattern, weight]) => sum + (pattern.test(line) ? weight : 0), 0);
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return contentLines.find((line) => /모집|교육|행사|프로그램|신청|대상|혜택|지원|참가/i.test(line)) ?? GENERIC_EVIDENCE;
}

function candidate(
  context: SourceContext,
  key: ExtractedKey,
  value: string,
  confidence: number,
  evidence = findEvidence(context.lines, value),
): FieldCandidate {
  return {
    value: value.trim(),
    sourceId: context.source.id,
    sourceName: context.source.fileName,
    page: context.source.page,
    evidence: cleanEvidenceForDisplay(key, value.trim(), evidence),
    confidence: scoreWithContext(key, confidence, context.source, evidence),
    isOcr: context.source.isOcr,
  };
}

function scoreWithContext(key: ExtractedKey, base: number, source: ProcessedSource, evidence: string) {
  let confidence = base;
  if (evidence !== GENERIC_EVIDENCE) confidence += 0.06;
  if (labelHints[key].some((hint) => evidence.toLowerCase().includes(hint.toLowerCase()))) confidence += 0.08;
  if (source.isOcr) confidence -= 0.12;
  return Math.max(0.35, Math.min(0.98, confidence));
}

function collectLabeledCandidates(context: SourceContext, key: ExtractedKey) {
  const results: FieldCandidate[] = [];
  for (const line of context.lines) {
    for (const label of labelHints[key]) {
      const pattern = new RegExp(`^(?:[가-힣A-Za-z0-9.\\s-]+[.)]\\s*)?${label}\\s*[:：-]\\s*(.+)$`, "i");
      const match = line.match(pattern);
      if (match?.[1]) {
        const item = candidate(context, key, cleanFieldValue(key, match[1]), 0.9, line);
        if (key === "period") {
          results.push({ ...item, periodKind: classifyPeriodLine(line) } as PeriodCandidate);
        } else {
          results.push(item);
        }
      }
    }
  }
  return results;
}

const SECTION_HEADER_PATTERN =
  /^(?:[■※*\-·•\s]+)?(참여대상|모집 대상|참가 대상|운영기간|세부일정|교육내용|행사 개요|프로그램 내용|주요 내용|참가 혜택|주요 혜택|혜택|참가 신청 및 문의|신청 및 문의|신청 방법|문의|문의처|신청 QR|일정|모집 대상|참가 제한)\s*[:：]?$/i;

const sectionHints: Partial<Record<ExtractedKey, string[]>> = {
  description: ["교육내용", "행사 개요", "프로그램 내용", "주요 내용"],
  audience: ["참여대상", "모집 대상", "참가 대상"],
  period: ["운영기간", "일정"],
  benefit: ["참가 혜택", "주요 혜택", "혜택"],
  applyMethod: ["참가 신청 및 문의", "신청 및 문의", "신청 방법", "신청 QR"],
  contact: ["참가 신청 및 문의", "신청 및 문의", "문의", "문의처"],
};

function sectionHeaderOf(line: string) {
  return line.replace(/^[■※*\-·•\s]+/, "").trim().match(SECTION_HEADER_PATTERN)?.[1] ?? "";
}

function cleanSectionLine(line: string) {
  return line
    .replace(/^[■※*\-·•\s]+/, "")
    .replace(/\s*[|｜]\s*$/, "")
    .trim();
}

function collectSectionCandidates(context: SourceContext, key: ExtractedKey) {
  const labels = sectionHints[key];
  if (!labels?.length) return [];

  const results: FieldCandidate[] = [];
  for (let index = 0; index < context.lines.length; index += 1) {
    const header = sectionHeaderOf(context.lines[index]);
    if (!header || !labels.some((label) => header.toLowerCase() === label.toLowerCase())) continue;

    const values: string[] = [];
    for (let cursor = index + 1; cursor < context.lines.length && values.length < 6; cursor += 1) {
      if (sectionHeaderOf(context.lines[cursor])) break;
      const value = cleanSectionLine(context.lines[cursor]);
      if (value) values.push(value);
    }
    if (!values.length) continue;

    const joined = values.join(" ");
    const link = joined.match(SINGLE_URL_PATTERN)?.[0] ?? "";
    const evidence = values.find((item) => (link ? item.includes(link) : item === values[0])) ?? joined;
    const rawValue = key === "applyMethod" || key === "contact"
      ? link || joined
      : key === "benefit"
        ? values.slice(0, 4).join(" / ")
        : joined;
    const value = cleanFieldValue(key, rawValue);
    if (!value) continue;
    const confidence = key === "benefit" || key === "description" ? 0.94 : 0.9;
    const item = candidate(context, key, value, confidence, evidence);
    results.push(key === "period" ? ({ ...item, periodKind: "event" } as PeriodCandidate) : item);
  }
  return results;
}

function cleanFieldValue(key: ExtractedKey, value: string) {
  let cleaned = value.replace(/\s+/g, " ").trim();
  if (key === "description") cleaned = cleanDescriptionValue(cleaned);
  if (key === "audience") cleaned = cleanAudienceValue(cleaned);
  if (key === "benefit") cleaned = cleanBenefitValue(cleaned);
  if (key === "contact") cleaned = cleanContactValue(cleaned);
  if (key === "period") cleaned = normalizeDatePhrase(cleaned);
  if (key === "applyMethod") {
    const link = cleaned.match(SINGLE_URL_PATTERN)?.[0];
    if (link) return link;
    cleaned = cleaned
      .replace(/문의.*$/, "")
      .replace(/담당자(?!\s*이메일\s*접수).*$/, "")
      .replace(/\s*바랍니다.*$/, "")
      .trim();
  }
  return cleaned;
}

function normalizeDateToken(token: string, fallbackYear?: string) {
  const compact = token.replace(/\s+/g, " ").trim();
  const withYear = compact.match(/(20\d{2})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})\s*일?\s*(\d{1,2}:\d{2})?/);
  if (withYear) {
    const [, year, month, day, time] = withYear;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${time ? ` ${time}` : ""}`;
  }

  const withoutYear = compact.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(\d{1,2}:\d{2})?/);
  if (withoutYear && fallbackYear) {
    const [, month, day, time] = withoutYear;
    return `${fallbackYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${time ? ` ${time}` : ""}`;
  }

  return compact;
}

function normalizeDatePhrase(value: string) {
  const omittedRange = normalizeOmittedYearDottedRange(value);
  const fallbackYear = value.match(/20\d{2}/)?.[0];
  return (omittedRange || value)
    .replace(DATE_TOKEN_PATTERN, (token) => normalizeDateToken(token, fallbackYear))
    .replace(/\.\s*\([^)]*\)/g, "")
    .replace(/\s*(부터|~|–|—|부터\s*~)\s*/g, " ~ ")
    .replace(/\s*(까지)\b/g, "까지")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function classifyPeriodLine(line: string): PeriodCandidate["periodKind"] {
  if (/신청|접수|지원|서류|마감|모집|application|deadline/i.test(line)) return "application";
  if (/행사|교육|운영|활동|근무|프로그램|강의|일시|program|period|event|education/i.test(line)) return "event";
  return "unknown";
}

function normalizeOmittedYearDottedRange(line: string) {
  const match = line.match(OMITTED_YEAR_DOTTED_RANGE_PATTERN);
  if (!match) return "";
  const [, startYear, startMonth, startDay, endYearRaw, endMonth, endDay] = match;
  const endYear = endYearRaw || startYear;
  return `${startYear}-${startMonth.padStart(2, "0")}-${startDay.padStart(2, "0")} ~ ${endYear}-${endMonth.padStart(2, "0")}-${endDay.padStart(2, "0")}`;
}

function normalizeEnglishDateRange(line: string) {
  const match = line.match(ENGLISH_DATE_RANGE_PATTERN);
  if (!match) return "";
  const [, startMonthDay, endDay, year] = match;
  return `${startMonthDay}-${endDay}, ${year}`;
}

function extractDatePhrase(line: string) {
  const dottedRange = normalizeOmittedYearDottedRange(line);
  if (dottedRange) return dottedRange;

  const englishRange = normalizeEnglishDateRange(line);
  if (englishRange) return englishRange;

  const matches = line.match(DATE_TOKEN_PATTERN);
  if (!matches?.length) return "";
  if (matches.length >= 2) return normalizeDatePhrase(`${matches[0]} ~ ${matches.at(-1)}`);
  const suffix = /까지|마감/.test(line) ? "까지" : "";
  return normalizeDatePhrase(`${matches[0]}${suffix}`);
}

const DATE_RANGE_PATTERN = /20\d{2}[.]\s*\d{1,2}[.]\s*\d{1,2}\s*~\s*20\d{2}[.]\s*\d{1,2}[.]\s*\d{1,2}/;
const TABLE_HEADER_WORDS = /주제|집단상담명|프로그램명|기간|시간|총시간|인원|내용|방식|대상|신청|문의|QR/i;

function cleanScheduleWhitespace(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*~\s*/g, " ~ ").trim();
}

function stripScheduleNoise(value: string) {
  return value
    .replace(TABLE_HEADER_WORDS, " ")
    .replace(/20\d{2}-?\d?\s*학기|여름방학|겨울방학|참가자\s*모집|모집\s*안내/g, " ")
    .replace(/[•✔·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferProgramLabel(lines: string[], dateLineIndex: number) {
  const candidates: string[] = [];
  for (let index = dateLineIndex - 1; index >= 0 && candidates.length < 2; index -= 1) {
    const line = stripScheduleNoise(lines[index] ?? "");
    if (!line || DATE_RANGE_PATTERN.test(line) || TABLE_HEADER_WORDS.test(line)) continue;
    if (/https?:\/\//i.test(line) || PHONE_PATTERN.test(line)) continue;
    if (line.length > 80) continue;
    candidates.unshift(line);
  }

  const combined = candidates.join(" ").trim();
  if (!combined) return "프로그램";

  const words = combined.split(/\s+/);
  if (words.length > 12) return words.slice(-12).join(" ");
  return combined;
}

function extractProgramScheduleFromLines(lines: string[], dateLineIndex: number) {
  const dateLine = lines[dateLineIndex];
  const range = dateLine.match(DATE_RANGE_PATTERN)?.[0];
  if (!range) return null;

  const block = [
    lines[dateLineIndex - 2] ?? "",
    lines[dateLineIndex - 1] ?? "",
    lines[dateLineIndex],
    lines[dateLineIndex + 1] ?? "",
    lines[dateLineIndex + 2] ?? "",
  ].join(" ");
  const label = inferProgramLabel(lines, dateLineIndex);
  const normalizedRange = normalizeDatePhrase(range);
  const weekday = block.match(/매주\s*(월|화|수|목|금|토|일)요일/)?.[0] ?? "";
  const sessions = block.match(/총\s*\d+\s*회기/)?.[0] ?? "";
  const time = block.match(/\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/)?.[0] ?? "";
  const capacity = block.match(/\d+\s*명\s*이내/)?.[0] ?? "";
  const method = block.match(/대면|비대면|온라인/)?.[0] ?? "";
  const details = [normalizedRange, weekday, sessions, time, capacity, method]
    .map(cleanScheduleWhitespace)
    .filter(Boolean)
    .join(", ");

  return `${label}: ${details}`;
}

function extractProgramSchedules(text: string) {
  const lines = linesOf(text);
  const schedules = lines
    .map((line, index) => (DATE_RANGE_PATTERN.test(line) ? extractProgramScheduleFromLines(lines, index) : null))
    .filter((value): value is string => Boolean(value));

  return schedules.length >= 2 ? schedules.join("\n") : "";
}

function collectProgramScheduleCandidates(context: SourceContext) {
  const value = extractProgramSchedules(context.source.text);
  if (!value) return [];
  return [{
    ...candidate(context, "period", value, 0.94, "첨부 이미지 표의 프로그램별 기간 및 시간"),
    periodKind: "event" as const,
  }];
}

function collectPeriodCandidates(context: SourceContext) {
  const results: PeriodCandidate[] = [];
  results.push(...collectProgramScheduleCandidates(context));
  for (const line of context.lines) {
    const phrase = extractDatePhrase(line);
    if (!phrase) continue;
    const periodKind = classifyPeriodLine(line);
    let base = periodKind === "application" ? 0.92 : periodKind === "event" ? 0.82 : 0.68;
    if (/변경|연장|수정|changed|extended/i.test(line)) base += 0.16;
    if (/기존|previous|old/i.test(line)) base -= 0.18;
    results.push({
      ...candidate(context, "period", phrase, base, line),
      periodKind,
    });
  }
  return results;
}

function linkScore(link: string, evidence: string) {
  let score = 0.58;
  if (/신청|접수|지원|apply|form|폼|구글폼|온라인/i.test(evidence)) score += 0.24;
  if (/forms\.gle|docs\.google\.com\/forms|form|apply|recruit|application/i.test(link)) score += 0.18;
  if (/문의|소개|공지|notice/i.test(evidence) && !/신청|접수|지원|apply|form|폼/i.test(evidence)) score -= 0.12;
  return Math.max(0.35, Math.min(0.98, score));
}

function collectApplyLinkCandidates(context: SourceContext) {
  const links = unique([...context.source.links, ...context.source.qrCodes.filter((value) => /^https?:\/\//i.test(value))]);
  const results: FieldCandidate[] = [];
  for (const link of links) {
    const evidence = context.lines.find((line) => line.includes(link)) ??
      context.lines.find((line) => /신청|접수|지원|apply|form|폼|온라인/i.test(line)) ??
      "QR 또는 링크에서 감지됨";
    const value = /신청|접수|지원|apply|form|폼|온라인/i.test(evidence)
      ? `${evidence.replace(link, "").trim()} ${link}`.trim()
      : link;
    results.push(candidate(context, "applyMethod", value, linkScore(link, evidence), evidence));
  }
  return results;
}

function combinePeriodValue(candidates: PeriodCandidate[]) {
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const application = ranked.find((item) => item.periodKind === "application");
  const event = ranked.find((item) => item.periodKind === "event");

  if (event?.value.includes("\n") && /: 20\d{2}-/.test(event.value)) {
    return {
      value: event.value,
      selected: event,
      selectedGroup: [event],
      hasConflict: false,
      confidence: event.confidence,
    };
  }

  if (application && event && normalizeCandidate(application.value) !== normalizeCandidate(event.value)) {
    return {
      value: `신청: ${application.value}\n행사/운영: ${event.value}`,
      selected: application,
      selectedGroup: [application, event],
      hasConflict: false,
      confidence: Math.min(0.98, (application.confidence + event.confidence) / 2 + 0.04),
    };
  }

  const selected = application ?? event ?? ranked[0];
  return selected
    ? {
        value: selected.value,
        selected,
        selectedGroup: ranked.filter((item) => normalizeCandidate(item.value) === normalizeCandidate(selected.value)),
        hasConflict: false,
        confidence: selected.confidence,
      }
    : null;
}

function mergeDistinctFieldValues(values: string[]) {
  const merged: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = normalizeCandidate(trimmed);
    const isDuplicate = merged.some((existing) => {
      const existingNormalized = normalizeCandidate(existing);
      return (
        existingNormalized === normalized ||
        existingNormalized.includes(normalized) ||
        normalized.includes(existingNormalized)
      );
    });
    if (isDuplicate) continue;
    merged.push(trimmed);
    if (merged.length >= 4) break;
  }
  return merged.join(" / ");
}

function simplifyLinkFieldValue(key: ExtractedKey, value: string) {
  if (key !== "applyMethod" && key !== "contact") return value;
  const links = value.match(URL_PATTERN);
  if (!links?.length) return value;
  return unique(links.map((link) => link.replace(/[|,.;]+$/, ""))).join(" / ");
}

function mergedValueForField(key: ExtractedKey, ranked: FieldCandidate[][], selected?: FieldCandidate) {
  if (!selected) return "";
  if (!["benefit", "applyMethod", "contact"].includes(key)) return selected.value;

  const groupValues = ranked
    .map((group) => [...group].sort((a, b) => b.confidence - a.confidence)[0])
    .filter((item): item is FieldCandidate => Boolean(item) && item.confidence >= 0.52)
    .map((item) => simplifyLinkFieldValue(key, item.value));

  const linkValues =
    key === "applyMethod" || key === "contact"
      ? groupValues.filter((value) => SINGLE_URL_PATTERN.test(value))
      : [];
  const merged = mergeDistinctFieldValues(linkValues.length ? linkValues : groupValues);
  return merged || simplifyLinkFieldValue(key, selected.value);
}

function displayCandidates(key: ExtractedKey, candidates: FieldCandidate[], selected?: FieldCandidate) {
  if (!selected) return candidates.slice(0, 1);
  const selectedHasLink = (key === "applyMethod" || key === "contact") && SINGLE_URL_PATTERN.test(selected.value);
  if (selectedHasLink) return [selected];
  const selectedComparable = selectedHasLink ? simplifyLinkFieldValue(key, selected.value) : selected.value;
  const alternatives = candidates
    .filter((item) => {
      const comparable = selectedHasLink ? simplifyLinkFieldValue(key, item.value) : item.value;
      return comparable !== selectedComparable;
    })
    .filter((item) => !selectedHasLink || SINGLE_URL_PATTERN.test(item.value))
    .sort((a, b) => b.confidence - a.confidence);
  return [selected, ...alternatives.slice(0, 1)];
}

function selectField(key: ExtractedKey, fieldCandidates: FieldCandidate[]): DetailedField {
  const usable = fieldCandidates.filter((item) => item.value.trim());
  if (key === "period") {
    const periodSelection = combinePeriodValue(usable as PeriodCandidate[]);
    if (periodSelection) {
      return {
        key,
        label: fieldLabels[key],
        value: periodSelection.confidence >= 0.52 ? periodSelection.value : "",
        confidence: periodSelection.confidence,
        sourceName: periodSelection.selected.sourceName,
        page: periodSelection.selected.page,
        evidence: periodSelection.selected.evidence,
        candidates: displayCandidates(key, usable, periodSelection.selected),
        hasConflict: false,
      };
    }
  }

  const groups = new Map<string, FieldCandidate[]>();
  for (const item of usable) {
    const normalized = normalizeCandidate(item.value);
    groups.set(normalized, [...(groups.get(normalized) ?? []), item]);
  }

  const ranked = [...groups.values()].sort((left, right) => {
    const leftScore = groupScore(key, left);
    const rightScore = groupScore(key, right);
    return rightScore - leftScore;
  });
  const selectedGroup = ranked[0] ?? [];
  const selected = selectedGroup.sort((a, b) => b.confidence - a.confidence)[0];
  const confidence = selected
    ? Math.max(0.35, Math.min(0.98, selected.confidence + (selectedGroup.length > 1 ? 0.06 : 0)))
    : 0;
  const value = selected && confidence >= 0.52 ? mergedValueForField(key, ranked, selected) : "";
  const displaySelected = selected && value ? { ...selected, value } : selected;

  return {
    key,
    label: fieldLabels[key],
    value,
    confidence,
    sourceName: selected?.sourceName ?? "",
    page: selected?.page,
    evidence: selected?.evidence ?? "",
    candidates: displayCandidates(key, usable, displaySelected),
    hasConflict: false,
  };
}

function groupScore(key: ExtractedKey, group: FieldCandidate[]) {
  const maxConfidence = Math.max(...group.map((item) => item.confidence));
  let score = maxConfidence + group.length * 0.04;
  if (key === "applyMethod" && group.some((item) => /^https?:\/\//i.test(item.value) || /https?:\/\//i.test(item.value))) {
    score += 0.16;
  }
  return score;
}

function makeManualSource(manualText: string): ProcessedSource {
  return {
    id: "manual-input",
    fileName: "직접 입력한 메일 본문",
    kind: "text",
    text: manualText.trim(),
    size: new Blob([manualText]).size,
    isOcr: false,
    links: manualText.match(URL_PATTERN) ?? [],
    qrCodes: [],
    warnings: [],
  };
}

export function analyzeSources(manualText: string, processedSources: ProcessedSource[]): AnalysisResult {
  const sources: ProcessedSource[] = manualText.trim()
    ? [makeManualSource(manualText), ...processedSources]
    : [...processedSources];
  const contexts = sources
    .filter((source) => source.text.trim())
    .map((source) => ({ source, lines: linesOf(source.text) }));

  const candidates = new Map<ExtractedKey, FieldCandidate[]>();
  keys.forEach((key) => candidates.set(key, []));

  for (const context of contexts) {
    const extracted = extractInfo(context.source.text);
    for (const key of keys) {
      const value = extracted[key];
      if (value) {
        candidates.get(key)?.push(candidate(
          context,
          key,
          cleanFieldValue(key, value),
          key === "category" ? 0.72 : 0.78,
          key === "category" ? categoryEvidence(context.lines, value) : undefined,
        ));
      }
      candidates.get(key)?.push(...collectLabeledCandidates(context, key));
      candidates.get(key)?.push(...collectSectionCandidates(context, key));
    }

    candidates.get("period")?.push(...collectPeriodCandidates(context));
    candidates.get("applyMethod")?.push(...collectApplyLinkCandidates(context));
  }

  const combinedText = contexts.map((context) => context.source.text).join("\n\n");
  const combined = extractInfo(combinedText);
  if (combinedText.trim()) {
    const combinedContext: SourceContext = {
      source: {
        id: "combined",
        fileName: "전체 문서",
        kind: "text",
        text: combinedText,
        size: new Blob([combinedText]).size,
        isOcr: false,
        links: combinedText.match(URL_PATTERN) ?? [],
        qrCodes: [],
        warnings: [],
      },
      lines: linesOf(combinedText),
    };
    for (const key of keys) {
      if (combined[key]) {
        candidates.get(key)?.push(candidate(
          combinedContext,
          key,
          cleanFieldValue(key, combined[key]),
          0.66,
          key === "category" ? categoryEvidence(combinedContext.lines, combined[key]) : undefined,
        ));
      }
    }
  }

  const fields = keys.map((key) => selectField(key, candidates.get(key) ?? []));
  const info = Object.fromEntries(
    fields.map((field) => [field.key, field.value || ""]),
  ) as ExtractedInfo;

  return {
    info,
    fields,
    conflicts: fields.filter((field) => field.hasConflict),
    links: unique(sources.flatMap((source) => [
      ...source.links,
      ...source.qrCodes.filter((value) => /^https?:\/\//i.test(value)),
    ])),
    qrCodes: unique(sources.flatMap((source) => source.qrCodes)),
  };
}

export { NEEDS_REVIEW };
