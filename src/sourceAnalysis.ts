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

export const fieldLabels: Record<ExtractedKey, string> = {
  category: "유형",
  audience: "대상",
  period: "기간",
  benefit: "주요 혜택",
  applyMethod: "신청 방법",
  contact: "문의처",
};

const keys = Object.keys(fieldLabels) as ExtractedKey[];

function normalizeCandidate(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s.,:：()[\]{}'"~-]/g, "")
    .replace(/까지|부터|에서|으로/g, "");
}

function meaningfulWords(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word.replace(/[^0-9A-Za-z가-힣@.-]/g, ""))
    .filter((word) => word.length >= 2);
}

function findEvidence(text: string, value: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const direct = lines.find((line) => line.includes(value) || value.includes(line.replace(/[.。]$/, "")));
  if (direct) return direct;

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
  return bestScore > 0 ? best : "규칙 기반으로 문서에서 감지됨";
}

function baseConfidence(key: ExtractedKey, source: ProcessedSource, evidence: string) {
  let confidence = key === "category" ? 0.78 : 0.88;
  if (evidence === "규칙 기반으로 문서에서 감지됨") confidence -= 0.12;
  if (source.isOcr) confidence -= 0.12;
  return Math.max(0.4, confidence);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function analyzeSources(manualText: string, processedSources: ProcessedSource[]): AnalysisResult {
  const sources: ProcessedSource[] = [...processedSources];
  if (manualText.trim()) {
    sources.unshift({
      id: "manual-input",
      fileName: "직접 입력한 메일 본문",
      kind: "text",
      text: manualText.trim(),
      size: new Blob([manualText]).size,
      isOcr: false,
      links: manualText.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [],
      qrCodes: [],
      warnings: [],
    });
  }

  const candidates = new Map<ExtractedKey, FieldCandidate[]>();
  keys.forEach((key) => candidates.set(key, []));

  for (const source of sources) {
    if (!source.text.trim()) continue;
    const extracted = extractInfo(source.text);
    for (const key of keys) {
      const value = extracted[key];
      if (!value) continue;
      const evidence = findEvidence(source.text, value);
      candidates.get(key)?.push({
        value,
        sourceId: source.id,
        sourceName: source.fileName,
        page: source.page,
        evidence,
        confidence: baseConfidence(key, source, evidence),
        isOcr: source.isOcr,
      });
    }
  }

  const combinedText = sources.map((source) => source.text).filter(Boolean).join("\n\n");
  const combined = extractInfo(combinedText);

  const fields = keys.map((key): DetailedField => {
    const fieldCandidates = candidates.get(key) ?? [];
    if (!fieldCandidates.length && combined[key]) {
      const matchingSource = sources.find((source) => findEvidence(source.text, combined[key]) !== "규칙 기반으로 문서에서 감지됨");
      fieldCandidates.push({
        value: combined[key],
        sourceId: matchingSource?.id ?? "combined",
        sourceName: matchingSource?.fileName ?? "전체 문서",
        page: matchingSource?.page,
        evidence: matchingSource ? findEvidence(matchingSource.text, combined[key]) : "여러 문서의 내용을 조합해 감지됨",
        confidence: matchingSource?.isOcr ? 0.62 : 0.72,
        isOcr: Boolean(matchingSource?.isOcr),
      });
    }

    const groups = new Map<string, FieldCandidate[]>();
    for (const candidate of fieldCandidates) {
      const normalized = normalizeCandidate(candidate.value);
      groups.set(normalized, [...(groups.get(normalized) ?? []), candidate]);
    }
    const ranked = [...groups.values()].sort((left, right) => {
      const countDifference = right.length - left.length;
      if (countDifference) return countDifference;
      return Math.max(...right.map((item) => item.confidence)) - Math.max(...left.map((item) => item.confidence));
    });
    const selectedGroup = ranked[0] ?? [];
    const selected = selectedGroup.sort((a, b) => b.confidence - a.confidence)[0];
    const hasConflict = ranked.length > 1;
    const confidence = selected
      ? Math.max(0.4, Math.min(0.98, selected.confidence + (selectedGroup.length > 1 ? 0.06 : 0) - (hasConflict ? 0.2 : 0)))
      : 0;

    return {
      key,
      label: fieldLabels[key],
      value: selected?.value ?? "",
      confidence,
      sourceName: selected?.sourceName ?? "",
      page: selected?.page,
      evidence: selected?.evidence ?? "",
      candidates: fieldCandidates,
      hasConflict,
    };
  });

  const info = Object.fromEntries(fields.map((field) => [field.key, field.value])) as ExtractedInfo;
  return {
    info,
    fields,
    conflicts: fields.filter((field) => field.hasConflict),
    links: unique(sources.flatMap((source) => source.links)),
    qrCodes: unique(sources.flatMap((source) => source.qrCodes)),
  };
}
