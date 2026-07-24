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
  category: "유형",
  audience: "대상",
  period: "기간",
  benefit: "주요 혜택",
  applyMethod: "신청 방법",
  contact: "문의처",
};

const keys = Object.keys(fieldLabels) as ExtractedKey[];
const NEEDS_REVIEW = "담당자 확인 필요";
const GENERIC_EVIDENCE = "규칙 기반으로 문서에서 감지됨";
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const DATE_TOKEN_PATTERN =
  /(?:20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}(?:\s*\d{1,2}:\d{2})?|20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\s*\d{1,2}:\d{2})?|\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\s*\d{1,2}:\d{2})?)/g;

const labelHints: Record<ExtractedKey, string[]> = {
  category: ["유형", "분류", "카테고리"],
  audience: ["모집 대상", "참가 대상", "지원 대상", "지원 자격", "대상", "Eligibility"],
  period: ["신청 기간", "접수 기간", "모집 기간", "모집 마감", "행사 일시", "교육 기간", "운영 기간", "활동 기간", "일시", "기간"],
  benefit: ["주요 혜택", "혜택", "참가 비용", "참가비", "지원 내용", "시상", "상금"],
  applyMethod: ["신청 방법", "접수 방법", "제출 방법", "지원 방법", "신청 링크", "신청", "Apply"],
  contact: ["문의", "문의처", "담당자", "연락처", "Contact"],
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
    evidence,
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
        results.push(candidate(context, key, cleanFieldValue(key, match[1]), 0.9, line));
      }
    }
  }
  return results;
}

function cleanFieldValue(key: ExtractedKey, value: string) {
  let cleaned = value.replace(/\s+/g, " ").trim();
  if (key === "period") cleaned = normalizeDatePhrase(cleaned);
  if (key === "applyMethod") {
    cleaned = cleaned
      .replace(/문의.*$/, "")
      .replace(/담당자.*$/, "")
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
  const fallbackYear = value.match(/20\d{2}/)?.[0];
  return value
    .replace(DATE_TOKEN_PATTERN, (token) => normalizeDateToken(token, fallbackYear))
    .replace(/\s*(부터|~|–|—|부터\s*~)\s*/g, " ~ ")
    .replace(/\s*(까지)\b/g, "까지")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function classifyPeriodLine(line: string): PeriodCandidate["periodKind"] {
  if (/신청|접수|지원|서류|마감|모집/.test(line)) return "application";
  if (/행사|교육|운영|활동|근무|프로그램|강의|일시/.test(line)) return "event";
  return "unknown";
}

function extractDatePhrase(line: string) {
  const matches = line.match(DATE_TOKEN_PATTERN);
  if (!matches?.length) return "";
  if (matches.length >= 2) return normalizeDatePhrase(`${matches[0]} ~ ${matches.at(-1)}`);
  const suffix = /까지|마감/.test(line) ? "까지" : "";
  return normalizeDatePhrase(`${matches[0]}${suffix}`);
}

function collectPeriodCandidates(context: SourceContext) {
  const results: PeriodCandidate[] = [];
  for (const line of context.lines) {
    const phrase = extractDatePhrase(line);
    if (!phrase) continue;
    const periodKind = classifyPeriodLine(line);
    const base = periodKind === "application" ? 0.92 : periodKind === "event" ? 0.82 : 0.68;
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
        hasConflict: ranked.some((item) => normalizeCandidate(item.value) !== normalizeCandidate(selected.value)),
        confidence: selected.confidence,
      }
    : null;
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
        candidates: usable,
        hasConflict: periodSelection.hasConflict,
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
  const hasConflict = ranked.length > 1;
  const confidence = selected
    ? Math.max(0.35, Math.min(0.98, selected.confidence + (selectedGroup.length > 1 ? 0.06 : 0) - (hasConflict ? 0.12 : 0)))
    : 0;

  return {
    key,
    label: fieldLabels[key],
    value: selected && confidence >= 0.52 ? selected.value : "",
    confidence,
    sourceName: selected?.sourceName ?? "",
    page: selected?.page,
    evidence: selected?.evidence ?? "",
    candidates: usable,
    hasConflict,
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
      if (value) candidates.get(key)?.push(candidate(context, key, cleanFieldValue(key, value), key === "category" ? 0.72 : 0.78));
      candidates.get(key)?.push(...collectLabeledCandidates(context, key));
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
        candidates.get(key)?.push(candidate(combinedContext, key, cleanFieldValue(key, combined[key]), 0.66));
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
