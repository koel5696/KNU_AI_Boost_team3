import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Mail,
  MessageCircle,
  Monitor,
  Paperclip,
  QrCode,
  RefreshCcw,
  Save,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import {
  buildHomepagePost,
  buildMessageDraft,
  buildSnsPost,
  sampleMail,
  type ExtractedInfo,
} from "./extractor";
import { auth, googleProvider } from "./firebase";
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILES,
  errorMessage,
  processDocumentFile,
  supportsFile,
  type ProcessedSource,
} from "./documentProcessor";
import {
  analyzeSources,
  fieldLabels,
  type AnalysisResult,
  type DetailedField,
  type ExtractedKey,
} from "./sourceAnalysis";
import {
  buildImageDraft,
  downloadImageDraft,
  type ImageDraft,
} from "./imageDraft";
import { loadNoticeDrafts, saveNoticeDraft, type SavedNotice } from "./noticeHistory";
import { analyzeNoticeWithAi } from "./aiNoticeApi";

type Channel = "homepage" | "sns" | "message";
type UploadStatus = "queued" | "processing" | "done" | "error";
type WorkflowStep = 1 | 2 | 3 | 4 | 5;
type ChannelDraftTexts = Record<Channel, string>;

type UploadItem = {
  id: string;
  file?: File;
  fileName: string;
  size: number;
  status: UploadStatus;
  progress: number;
  message: string;
  error?: string;
  previewUrl?: string;
  sources: ProcessedSource[];
};

const channelLabels: Record<Channel, string> = {
  homepage: "홈페이지",
  sns: "SNS",
  message: "메시지",
};

const SESSION_DRAFT_KEY = "knu-notice-ai-session-draft";

type SessionDraftState = {
  mailText: string;
  analysis: AnalysisResult | null;
  loadedResult: ExtractedInfo | null;
  draftTexts: ChannelDraftTexts | null;
  activeChannel: Channel;
  currentStep: WorkflowStep;
  copyReviewConfirmed: boolean;
};

const channels: Channel[] = ["homepage", "sns", "message"];
const workflowSteps: WorkflowStep[] = [1, 2, 3, 4, 5];

function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && channels.includes(value as Channel);
}

function isWorkflowStep(value: unknown): value is WorkflowStep {
  return typeof value === "number" && workflowSteps.includes(value as WorkflowStep);
}

function isDraftTexts(value: unknown): value is ChannelDraftTexts {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ChannelDraftTexts>;
  return channels.every((channel) => typeof draft[channel] === "string");
}

function isImageFileName(fileName: string) {
  return /\.(png|jpe?g|webp|bmp|heic|heif)$/i.test(fileName);
}

function loadSessionDraft(): SessionDraftState | null {
  try {
    const historyDraft = window.history.state?.[SESSION_DRAFT_KEY] as Partial<SessionDraftState> | undefined;
    const raw = historyDraft ? JSON.stringify(historyDraft) : window.sessionStorage.getItem(SESSION_DRAFT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SessionDraftState>;
    const hasResult = Boolean(parsed.analysis || parsed.loadedResult);
    const currentStep =
      isWorkflowStep(parsed.currentStep) && (hasResult || parsed.currentStep === 1 || parsed.currentStep === 5)
        ? parsed.currentStep
        : 1;

    return {
      mailText: typeof parsed.mailText === "string" ? parsed.mailText : sampleMail,
      analysis: parsed.analysis ?? null,
      loadedResult: parsed.loadedResult ?? null,
      draftTexts: isDraftTexts(parsed.draftTexts) ? parsed.draftTexts : null,
      activeChannel: isChannel(parsed.activeChannel) ? parsed.activeChannel : "homepage",
      currentStep,
      copyReviewConfirmed: Boolean(parsed.copyReviewConfirmed),
    };
  } catch {
    window.sessionStorage.removeItem(SESSION_DRAFT_KEY);
    return null;
  }
}

function saveSessionDraft(state: SessionDraftState) {
  try {
    window.sessionStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify(state));
  } catch {
    // Session storage can fail in private mode or when the browser quota is full.
  }
  try {
    window.history.replaceState(
      { ...(window.history.state || {}), [SESSION_DRAFT_KEY]: state },
      "",
      window.location.href,
    );
  } catch {
    // History state is only a same-tab backup; failing to write it should not break editing.
  }
}

function clearSessionDraft() {
  try {
    window.sessionStorage.removeItem(SESSION_DRAFT_KEY);
  } catch {
    // Nothing to recover here; the in-memory state is still reset.
  }
  try {
    const nextState = { ...(window.history.state || {}) };
    delete nextState[SESSION_DRAFT_KEY];
    window.history.replaceState(nextState, "", window.location.href);
  } catch {
    // Ignore history cleanup failures.
  }
}

function mergeAiAnalysis(
  localAnalysis: AnalysisResult,
  aiInfo: ExtractedInfo,
  provider = "AI",
  model = "",
): AnalysisResult {
  const mergedInfo = { ...localAnalysis.info };
  const modelLabel = model ? `${provider} ${model}` : provider;

  const fields = localAnalysis.fields.map((field) => {
    const value = aiInfo[field.key]?.trim();
    if (!value) return field;

    mergedInfo[field.key] = value;
    const localCandidate =
      field.value && field.value !== value
        ? [{
            value: field.value,
            sourceId: "local-analysis",
            sourceName: field.sourceName || "기본 분석 결과",
            page: field.page,
            evidence: field.evidence || "기본 분석에서 선택한 값",
            confidence: field.confidence,
            isOcr: false,
          }]
        : [];

    return {
      ...field,
      value,
      confidence: Math.max(field.confidence, 0.9),
      sourceName: modelLabel,
      evidence: "메일 본문과 첨부파일을 함께 분석해 선택한 값입니다.",
      candidates: localCandidate,
      hasConflict: false,
    };
  });

  return {
    ...localAnalysis,
    info: mergedInfo,
    fields,
    conflicts: [],
  };
}

function App() {
  const restoredSessionRef = useRef<SessionDraftState | null | undefined>(undefined);
  if (restoredSessionRef.current === undefined) {
    restoredSessionRef.current = loadSessionDraft();
  }
  const restoredSession = restoredSessionRef.current;

  const [mailText, setMailText] = useState(restoredSession?.mailText ?? sampleMail);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(restoredSession?.analysis ?? null);
  const [loadedResult, setLoadedResult] = useState<ExtractedInfo | null>(restoredSession?.loadedResult ?? null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("홈페이지 초안 복사");
  const [draftTexts, setDraftTexts] = useState<ChannelDraftTexts | null>(restoredSession?.draftTexts ?? null);
  const [activeChannel, setActiveChannel] = useState<Channel>(restoredSession?.activeChannel ?? "homepage");
  const [imageStatus, setImageStatus] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [savedNotices, setSavedNotices] = useState<SavedNotice[]>([]);
  const [historyMessage, setHistoryMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(restoredSession?.currentStep ?? 1);
  const [copyReviewConfirmed, setCopyReviewConfirmed] = useState(restoredSession?.copyReviewConfirmed ?? false);
  const [imagePreview, setImagePreview] = useState<{ fileName: string; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionSnapshotRef = useRef<SessionDraftState | null>(null);
  const isWorkspacePage = window.location.pathname.startsWith("/workspace");

  const moveToStep = (step: WorkflowStep) => {
    if ((step === 2 || step === 3 || step === 4) && !result) return;
    setCurrentStep(step);
  };

  const openWorkspace = () => {
    window.location.assign("/workspace");
  };

  const returnToLandingTop = () => {
    window.location.assign("/");
  };

  const persistSessionNow = (overrides: Partial<SessionDraftState>) => {
    saveSessionDraft({
      mailText,
      analysis,
      loadedResult,
      draftTexts,
      activeChannel,
      currentStep,
      copyReviewConfirmed,
      ...overrides,
    });
  };

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }

    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setHistoryMessage("");
      setSaveMessage("");

      if (!currentUser) {
        setSavedNotices([]);
        setSaveMessage("비로그인 상태입니다. 분석과 복사는 가능하지만 저장은 로그인 후 사용할 수 있습니다.");
        return;
      }

      try {
        const notices = await loadNoticeDrafts(currentUser.uid);
        setSavedNotices(notices);
        setSaveMessage(`${currentUser.displayName || "로그인 사용자"} 계정으로 저장할 수 있습니다. 저장된 공지는 아래 목록에서 다시 불러옵니다.`);
      } catch {
        setHistoryMessage("저장된 공지를 불러오지 못했습니다. 저장 설정을 확인해 주세요.");
      }
    });
  }, []);

  const allSources = useMemo(
    () => uploads.flatMap((upload) => upload.sources),
    [uploads],
  );
  const aiFiles = useMemo(
    () => uploads
      .filter((upload) => upload.status === "done" && upload.file)
      .map((upload) => upload.file as File),
    [uploads],
  );
  const isProcessing = uploads.some(
    (upload) => upload.status === "processing" || upload.status === "queued",
  );
  const result = analysis?.info ?? loadedResult;
  const descriptionField = analysis?.fields.find((field) => field.key === "description") ?? (result
    ? {
        key: "description" as ExtractedKey,
        label: fieldLabels.description,
        value: result.description ?? "",
        confidence: result.description ? 1 : 0,
        sourceName: "",
        evidence: "",
        candidates: [],
        hasConflict: false,
      }
    : null);
  const post = useMemo(() => (result ? buildHomepagePost(result) : null), [result]);
  const imageDraft = useMemo(
    () => (result ? buildImageDraft(result, channelLabels[activeChannel]) : null),
    [activeChannel, result],
  );

  const channelDrafts = useMemo(() => {
    if (!result || !post) return null;
    const sns = buildSnsPost(result);
    const message = buildMessageDraft(result);
    return {
      homepage: post.copyText,
      sns: sns.copyText,
      message: message.copyText,
      snsPost: sns,
      messageDraft: message,
    };
  }, [post, result]);

  useEffect(() => {
    if (!channelDrafts) {
      setDraftTexts(null);
      return;
    }

    const generatedDrafts = {
      homepage: channelDrafts.homepage,
      sns: channelDrafts.sns,
      message: channelDrafts.message,
    };
    setDraftTexts((current) => current ?? generatedDrafts);
  }, [channelDrafts]);

  useEffect(() => {
    sessionSnapshotRef.current = {
      mailText,
      analysis,
      loadedResult,
      draftTexts,
      activeChannel,
      currentStep,
      copyReviewConfirmed,
    };

    const hasSessionWork =
      mailText !== sampleMail ||
      Boolean(analysis) ||
      Boolean(loadedResult) ||
      Boolean(draftTexts) ||
      activeChannel !== "homepage" ||
      currentStep !== 1 ||
      copyReviewConfirmed;

    if (!hasSessionWork) {
      clearSessionDraft();
      return;
    }

    saveSessionDraft({
      mailText,
      analysis,
      loadedResult,
      draftTexts,
      activeChannel,
      currentStep,
      copyReviewConfirmed,
    });
  }, [activeChannel, analysis, copyReviewConfirmed, currentStep, draftTexts, loadedResult, mailText]);

  useEffect(() => {
    const flushVisibleDraft = () => {
      const snapshot = sessionSnapshotRef.current;
      if (!snapshot) return;

      const editor = document.getElementById(`draft-editor-${snapshot.activeChannel}`);
      const checkbox = document.getElementById(`copy-review-${snapshot.activeChannel}`);
      const visibleDraftTexts =
        editor instanceof HTMLTextAreaElement && snapshot.draftTexts
          ? { ...snapshot.draftTexts, [snapshot.activeChannel]: editor.value }
          : snapshot.draftTexts;

      saveSessionDraft({
        ...snapshot,
        draftTexts: visibleDraftTexts,
        copyReviewConfirmed:
          checkbox instanceof HTMLInputElement ? checkbox.checked : snapshot.copyReviewConfirmed,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushVisibleDraft();
    };

    window.addEventListener("beforeunload", flushVisibleDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const syncTimer = window.setInterval(flushVisibleDraft, 700);
    return () => {
      window.removeEventListener("beforeunload", flushVisibleDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(syncTimer);
    };
  }, []);

  useEffect(() => {
    const handleNativeDraftInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.id.startsWith("draft-editor-")) return;

      const channel = target.id.replace("draft-editor-", "");
      if (!isChannel(channel)) return;

      setDraftTexts((drafts) => {
        if (!drafts) return drafts;
        const nextDrafts = { ...drafts, [channel]: target.value };
        const snapshot = sessionSnapshotRef.current;
        if (snapshot) {
          saveSessionDraft({
            ...snapshot,
            draftTexts: nextDrafts,
            copyReviewConfirmed: false,
          });
        }
        return nextDrafts;
      });
      setCopyReviewConfirmed(false);
      setCopyState(`${channelLabels[channel]} 초안 복사`);
    };

    document.addEventListener("input", handleNativeDraftInput, true);
    document.addEventListener("change", handleNativeDraftInput, true);
    return () => {
      document.removeEventListener("input", handleNativeDraftInput, true);
      document.removeEventListener("change", handleNativeDraftInput, true);
    };
  }, []);

  const missingItems = useMemo(() => {
    if (!result) return [];
    return (Object.entries(result) as Array<[ExtractedKey, string]>)
      .filter(([, value]) => !value)
      .map(([key]) => fieldLabels[key]);
  }, [result]);

  const evidenceItems = useMemo(() => {
    if (!result || analysis) return [];
    const lines = mailText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return (Object.entries(result) as Array<[ExtractedKey, string]>)
      .filter(([, value]) => value)
      .map(([key, value]) => {
        const source = lines.find((line) => line.includes(value) || value.includes(line.replace(/[.。]$/, "")));
        return {
          label: fieldLabels[key],
          source: source || "원문에서 규칙 기반으로 감지됨",
        };
      });
  }, [analysis, mailText, result]);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    setError("");
    setAnalysis(null);
    setLoadedResult(null);
    const remaining = Math.max(0, MAX_FILES - uploads.length);
    const files = Array.from(fileList).slice(0, remaining);
    if (!files.length) {
      setError(`파일은 최대 ${MAX_FILES}개까지 추가할 수 있습니다.`);
      return;
    }

    const items: UploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: supportsFile(file) ? file : undefined,
      fileName: file.name,
      size: file.size,
      status: supportsFile(file) ? "queued" : "error",
      progress: 0,
      message: supportsFile(file) ? "처리 대기 중" : "지원하지 않는 파일 형식",
      error: supportsFile(file) ? undefined : "지원하지 않는 파일 형식입니다.",
      previewUrl: isImageFileName(file.name) ? URL.createObjectURL(file) : undefined,
      sources: [],
    }));
    setUploads((current) => [...current, ...items]);

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const item = items[index];
      if (!supportsFile(file)) continue;
      setUploads((current) =>
        current.map((upload) =>
          upload.id === item.id
            ? { ...upload, status: "processing", progress: 1, message: "파일 확인 중" }
            : upload,
        ),
      );
      try {
        const sources = await processDocumentFile(file, ({ progress, message }) => {
          setUploads((current) =>
            current.map((upload) =>
              upload.id === item.id ? { ...upload, progress, message } : upload,
            ),
          );
        });
        setUploads((current) =>
          current.map((upload) =>
            upload.id === item.id
              ? {
                  ...upload,
                  status: "done",
                  progress: 100,
                  message: `${sources.length}개 문서 영역 추출 완료`,
                  sources,
                }
              : upload,
          ),
        );
      } catch (caught) {
        setUploads((current) =>
          current.map((upload) =>
            upload.id === item.id
              ? {
                  ...upload,
                  status: "error",
                  progress: 0,
                  message: "처리 실패",
                  error: errorMessage(caught),
                }
              : upload,
          ),
        );
      }
    }
  }, [uploads.length]);

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files?.length) return;

      event.preventDefault();
      void processFiles(files);
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [processFiles]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void processFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) void processFiles(event.dataTransfer.files);
  };

  const handleGenerate = async () => {
    setActiveChannel("homepage");
    setCopyReviewConfirmed(false);
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
    setError("");
    setHistoryMessage("");
    setSaveMessage(user ? "분석 결과가 갱신되었습니다. 검토 후 저장하면 저장된 공지 목록에 추가됩니다." : "분석 결과가 갱신되었습니다. 비로그인 상태에서는 복사와 이미지 저장만 가능하고, 공지 저장은 로그인 후 가능합니다.");

    if (isProcessing || isAnalyzing) {
      setError("파일 처리가 끝난 뒤 내용을 정리해 주세요.");
      return;
    }
    if (!mailText.trim() && !allSources.some((source) => source.text.trim())) {
      setAnalysis(null);
      setLoadedResult(null);
      setError("메일 본문을 입력하거나 분석할 파일을 추가해 주세요.");
      return;
    }

    setIsAnalyzing(true);
    try {
      setLoadedResult(null);
      const localAnalysis = analyzeSources(mailText, allSources);
      let nextAnalysis = localAnalysis;

      try {
        const aiResult = await analyzeNoticeWithAi(mailText, allSources, aiFiles);
        nextAnalysis = mergeAiAnalysis(localAnalysis, aiResult.info, aiResult.provider, aiResult.model);
        setSaveMessage(user
          ? "AI 분석 결과가 반영되었습니다. 검토 후 저장하면 저장된 공지 목록에 추가됩니다."
          : "AI 분석 결과가 반영되었습니다. 비로그인 상태에서는 복사까지 가능하고 저장과 이미지 제작은 로그인 후 사용할 수 있습니다.");
      } catch {
        nextAnalysis = localAnalysis;
        setSaveMessage(user
          ? "AI 분석 서버 응답을 받지 못해 기본 분석 결과로 정리했습니다. 검토 후 저장할 수 있습니다."
          : "AI 분석 서버 응답을 받지 못해 기본 분석 결과로 정리했습니다. 저장과 이미지 제작은 로그인 후 사용할 수 있습니다.");
      }

      const nextPost = buildHomepagePost(nextAnalysis.info);
      const nextSns = buildSnsPost(nextAnalysis.info);
      const nextMessage = buildMessageDraft(nextAnalysis.info);
      const nextDraftTexts = {
        homepage: nextPost.copyText,
        sns: nextSns.copyText,
        message: nextMessage.copyText,
      };
      setAnalysis(nextAnalysis);
      setDraftTexts(nextDraftTexts);
      setCurrentStep(2);
      persistSessionNow({
        analysis: nextAnalysis,
        loadedResult: null,
        draftTexts: nextDraftTexts,
        activeChannel: "homepage",
        currentStep: 2,
        copyReviewConfirmed: false,
      });
    } catch {
      setAnalysis(null);
      setLoadedResult(null);
      setError("결과 생성에 실패했습니다. 파일 추출 결과와 메일 내용을 확인해 주세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    clearSessionDraft();
    setMailText("");
    uploads.forEach((upload) => {
      if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    });
    setUploads([]);
    setImagePreview(null);
    setAnalysis(null);
    setLoadedResult(null);
    setError("");
    setHistoryMessage("");
    setSaveMessage(user ? "입력을 초기화했습니다. 새 공지를 만든 뒤 저장할 수 있습니다." : "입력을 초기화했습니다. 저장 기능은 로그인 후 사용할 수 있습니다.");
    setActiveChannel("homepage");
    setCopyReviewConfirmed(false);
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
    setCurrentStep(1);
  };

  const removeUpload = (id: string) => {
    setUploads((current) => {
      const target = current.find((upload) => upload.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (imagePreview?.url === target?.previewUrl) setImagePreview(null);
      return current.filter((upload) => upload.id !== id);
    });
    setAnalysis(null);
    setLoadedResult(null);
    setCopyReviewConfirmed(false);
  };

  const handleCopy = async () => {
    if (!draftTexts) return;
    if (!copyReviewConfirmed) {
      setCopyState("검토 체크 후 복사");
      return;
    }

    try {
      await navigator.clipboard.writeText(draftTexts[activeChannel]);
      setCopyState(`${channelLabels[activeChannel]} 초안 복사됨`);
    } catch {
      setCopyState("복사 실패");
    }
  };

  const handleDraftChange = (value: string) => {
    setDraftTexts((drafts) => {
      if (!drafts) return drafts;
      const nextDrafts = { ...drafts, [activeChannel]: value };
      persistSessionNow({ draftTexts: nextDrafts, copyReviewConfirmed: false });
      return nextDrafts;
    });
    setCopyReviewConfirmed(false);
    setCopyState(`${channelLabels[activeChannel]} 초안 복사`);
  };

  const handleChannelSelect = (channel: Channel) => {
    setActiveChannel(channel);
    setCopyState(`${channelLabels[channel]} 초안 복사`);
    setImageStatus("");
  };

  const handleImageDownload = async () => {
    if (!imageDraft) return;
    if (!user) {
      setImageStatus("이미지 제작은 로그인 후 사용할 수 있습니다.");
      return;
    }
    setImageStatus("이미지 만드는 중...");
    try {
      const fileName = await downloadImageDraft(imageDraft);
      setImageStatus(`${fileName} 저장 완료`);
    } catch {
      setImageStatus("이미지 저장에 실패했습니다.");
    }
  };

  const handleOpenImageStep = () => {
    if (!user) {
      setSaveMessage("이미지 제작은 로그인 후 사용할 수 있습니다.");
      return;
    }
    moveToStep(4);
  };

  const updateField = (key: ExtractedKey, value: string) => {
    setAnalysis((current) => {
      if (!current) return current;
      const info = { ...current.info, [key]: value };
      const fields = current.fields.map((field) =>
        field.key === key
          ? {
              ...field,
              value,
              confidence: 1,
              sourceName: "사용자 수정",
              evidence: "담당자가 직접 확인하고 수정한 값",
              hasConflict: false,
            }
          : field,
      );
      return {
        ...current,
        info,
        fields,
        conflicts: fields.filter((field) => field.hasConflict),
      };
    });
    setLoadedResult((current) => (current ? { ...current, [key]: value } : current));
    setDraftTexts(null);
    setCopyReviewConfirmed(false);
  };

  const handleLogin = async () => {
    setHistoryMessage("");
    setSaveMessage("");
    if (!auth || !googleProvider) {
      setHistoryMessage("로그인 설정 후 저장 기능을 사용할 수 있습니다.");
      setSaveMessage("로그인 설정이 없어 로그인과 저장 기능이 비활성화되어 있습니다.");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setHistoryMessage("로그인에 실패했습니다. 로그인 설정을 확인해 주세요.");
      setSaveMessage("로그인에 실패해 저장 기능을 사용할 수 없습니다. 로그인 설정을 확인해 주세요.");
    }
  };

  const handleLogout = async () => {
    setHistoryMessage("");
    setSaveMessage("로그아웃했습니다. 현재 화면의 분석/복사는 가능하지만 저장된 공지는 계정에 연결되지 않습니다.");
    if (!auth) return;
    await signOut(auth);
  };

  const handleSave = async () => {
    if (!user) {
      setHistoryMessage("로그인해야 공지를 저장할 수 있습니다.");
      setSaveMessage("저장하지 않았습니다. 로그인 후 저장하면 계정별 공지로 보관됩니다.");
      return;
    }
    if (!post || !result) {
      setSaveMessage("저장할 공지 초안이 없습니다. 먼저 전체 내용 정리하기를 실행해 주세요.");
      return;
    }

    setIsSaving(true);
    setHistoryMessage("");
    setSaveMessage("공지 초안을 저장하는 중입니다.");
    try {
      const saved = await saveNoticeDraft({
        userId: user.uid,
        post,
        sourceMail: mailText,
        extractedInfo: result,
      });
      setSavedNotices((current) => [saved, ...current]);
      setHistoryMessage("현재 공지 초안을 저장했습니다.");
      setSaveMessage("저장되었습니다. 아래 저장된 공지 목록 맨 위에서 다시 불러올 수 있습니다.");
    } catch {
      setHistoryMessage("공지 저장에 실패했습니다. 저장 권한과 설정을 확인해 주세요.");
      setSaveMessage("저장에 실패했습니다. 저장 권한, 설정, 네트워크 상태를 확인해 주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadSavedNotice = (notice: SavedNotice) => {
    setMailText(notice.sourceMail);
    setUploads([]);
    setAnalysis(null);
    setLoadedResult(notice.extractedInfo);
    setDraftTexts({
      homepage: notice.post.copyText,
      sns: buildSnsPost(notice.extractedInfo).copyText,
      message: buildMessageDraft(notice.extractedInfo).copyText,
    });
    setActiveChannel("homepage");
    setCopyReviewConfirmed(false);
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
    setHistoryMessage("저장된 공지를 현재 작업 화면으로 불러왔습니다.");
    setCurrentStep(2);
    setSaveMessage("저장된 공지를 불러왔습니다. 수정 후 다시 저장하면 새 저장 항목으로 추가됩니다.");
  };

  return (
    <main>
      {!isWorkspacePage && <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-orbit landing-orbit-one" aria-hidden="true" />
        <div className="landing-orbit landing-orbit-two" aria-hidden="true" />

        <nav className="landing-nav" aria-label="소개 페이지 메뉴">
          <button className="landing-brand" type="button" onClick={returnToLandingTop} aria-label="공지메이트 홈">
            <span aria-hidden="true">📣</span>
            <strong>공지메이트</strong>
          </button>
          <div className="landing-nav-links">
            <a href="#how-it-works">작동 방식</a>
            <button type="button" onClick={openWorkspace}>공지 만들기</button>
            <AuthPanel authReady={authReady} user={user} onLogin={handleLogin} onLogout={handleLogout} />
          </div>
        </nav>

        <div className="landing-content" id="top">
          <div className="landing-copy">
            <p className="landing-kicker">
              <Sparkles size={15} />
              강남대학교 공지메이트
            </p>
            <h1 id="landing-title">
              메일 한 통이
              <span>모든 채널의 공지</span>가 됩니다.
            </h1>
            <p className="landing-description">
              이메일과 첨부파일을 넣으면 핵심 정보를 찾아 검토하고,
              홈페이지·SNS·메시지·홍보 이미지 초안까지 한 번에 완성합니다.
            </p>
            <div className="landing-actions">
              <button className="landing-primary" type="button" onClick={openWorkspace}>
                지금 공지 만들기
                <ArrowRight size={19} />
              </button>
              <a className="landing-secondary" href="#how-it-works">
                30초 만에 이해하기
              </a>
            </div>
            <div className="landing-trust" aria-label="서비스 특징">
              <span><CheckCircle2 size={15} /> 브라우저에서 안전하게 처리</span>
              <span><CheckCircle2 size={15} /> 게시 전 담당자 검토</span>
            </div>
          </div>

          <div className="product-demo" aria-label="메일이 채널별 공지로 변환되는 과정을 보여주는 화면">
            <div className="demo-window">
              <div className="demo-toolbar">
                <div className="demo-dots" aria-hidden="true"><i /><i /><i /></div>
                <span><Sparkles size={14} /> 공지메이트가 공지를 만들고 있어요</span>
                <em>LIVE</em>
              </div>

              <div className="demo-board">
                <div className="demo-source">
                  <div className="demo-label"><span>01</span> 자료 입력</div>
                  <div className="source-card source-mail">
                    <div className="source-icon"><Mail size={18} /></div>
                    <div>
                      <strong>2026 하계 인턴십 모집</strong>
                      <span>대외협력팀 · 방금 전</span>
                    </div>
                    <CheckCircle2 className="source-check" size={17} />
                  </div>
                  <div className="source-card source-file">
                    <div className="source-icon"><Paperclip size={18} /></div>
                    <div>
                      <strong>모집요강.pdf</strong>
                      <span>8페이지 · 분석 완료</span>
                    </div>
                    <CheckCircle2 className="source-check" size={17} />
                  </div>
                </div>

                <div className="demo-engine" aria-hidden="true">
                  <div className="engine-line"><i /></div>
                  <div className="engine-core"><Sparkles size={22} /></div>
                  <div className="engine-line"><i /></div>
                </div>

                <div className="demo-result">
                  <div className="demo-label"><span>02</span> 공지 완성</div>
                  <div className="result-sheet">
                    <div className="result-sheet-head">
                      <span className="result-category">취업·진로</span>
                      <span className="result-status"><CheckCircle2 size={13} /> 검토 준비</span>
                    </div>
                    <h2>2026 하계 인턴십<br />참여자 모집</h2>
                    <p>재학생을 위한 현장 실무 경험과<br />직무 멘토링 기회를 제공합니다.</p>
                    <dl>
                      <div><dt>대상</dt><dd>강남대학교 재학생</dd></div>
                      <div><dt>기간</dt><dd>7. 1. — 8. 28.</dd></div>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="channel-strip">
                <span className="channel-strip-title">채널별 초안 자동 생성</span>
                <div className="channel-item channel-home"><Monitor size={17} /><strong>홈페이지</strong><i /></div>
                <div className="channel-item channel-sns"><Hash size={17} /><strong>SNS</strong><i /></div>
                <div className="channel-item channel-message"><MessageCircle size={17} /><strong>메시지</strong><i /></div>
                <div className="channel-item channel-image"><ImageIcon size={17} /><strong>홍보 이미지</strong><i /></div>
              </div>
            </div>
            <div className="demo-float demo-float-time">
              <strong>10분 → 1분</strong>
              <span>반복 작성 시간 단축</span>
            </div>
            <div className="demo-float demo-float-safe">
              <CheckCircle2 size={18} />
              <span>근거까지 함께 확인</span>
            </div>
          </div>
        </div>

      </section>}

      {!isWorkspacePage && <section className="landing-flow-section" id="how-it-works" aria-labelledby="flow-title">
        <div className="flow-heading">
          <p className="landing-kicker">
            <Sparkles size={15} />
            작동 방식
          </p>
          <h2 id="flow-title">메일에서 공지까지 이어지는 흐름</h2>
          <p>
            입력한 메일과 첨부파일이 어떤 단계를 거쳐 검토 가능한 공지와 홍보 이미지로 바뀌는지 한눈에 확인할 수 있습니다.
          </p>
        </div>

        <div className="flow-timeline" aria-label="공지 제작 흐름">
          <article>
            <span className="flow-number">01</span>
            <div className="flow-icon"><Mail size={22} /></div>
            <h3>자료 입력</h3>
            <p>메일 본문, EML, PDF, Word, Excel, 이미지를 한 작업 공간에 모읍니다.</p>
          </article>
          <ArrowRight size={22} aria-hidden="true" />
          <article>
            <span className="flow-number">02</span>
            <div className="flow-icon"><Sparkles size={22} /></div>
            <h3>정보 추출</h3>
            <p>대상, 기간, 혜택, 신청 방법과 링크를 후보·근거와 함께 정리합니다.</p>
          </article>
          <ArrowRight size={22} aria-hidden="true" />
          <article>
            <span className="flow-number">03</span>
            <div className="flow-icon"><Clipboard size={22} /></div>
            <h3>채널별 초안</h3>
            <p>홈페이지, SNS, 메시지 문구를 바로 편집하고 현재 문구를 복사합니다.</p>
          </article>
          <ArrowRight size={22} aria-hidden="true" />
          <article>
            <span className="flow-number">04</span>
            <div className="flow-icon"><ImageIcon size={22} /></div>
            <h3>이미지 제작</h3>
            <p>검토한 정보로 1080 x 1350 공지 이미지를 만들어 저장합니다.</p>
          </article>
        </div>

        <div className="flow-summary">
          <div><strong>저장</strong><span>로그인하면 만든 공지를 저장하고 다시 불러올 수 있습니다.</span></div>
          <div><strong>보안 흐름</strong><span>파일 분석은 브라우저에서 처리하고 저장 시 공지 초안 정보만 전송합니다.</span></div>
          <button className="landing-primary" type="button" onClick={openWorkspace}>
            작업 공간 열기
            <ArrowRight size={19} />
          </button>
        </div>
      </section>}

      {isWorkspacePage && <>
      <header className="site-header" id="notice-workspace">
        <div className="brand-bar">
          <button className="workspace-brand" type="button" onClick={returnToLandingTop} aria-label="공지메이트 첫 화면">
            <span aria-hidden="true">📣</span>
            <strong>공지메이트</strong>
          </button>
          <div className="workspace-context">
            <small>강남대학교</small>
            <span>공지 제작 워크스페이스</span>
          </div>
          <nav aria-label="서비스 메뉴">
            <button type="button" onClick={() => window.location.assign("/")}>서비스 홈</button>
            <button type="button" onClick={() => moveToStep(1)}>새 공지</button>
            <button type="button" onClick={() => moveToStep(5)}>저장 공지</button>
          </nav>
          <AuthPanel authReady={authReady} user={user} onLogin={handleLogin} onLogout={handleLogout} />
        </div>
      </header>

      <div className="page-shell">
        <ol className="stepper" aria-label="공지 작성 단계">
          {[
            { step: 1 as const, label: "자료 입력" },
            { step: 2 as const, label: "정보 검토" },
            { step: 3 as const, label: "초안 작성" },
            { step: 4 as const, label: "이미지 제작" },
            { step: 5 as const, label: "저장 공지" },
          ].map((item) => (
            <li
              key={item.step}
              className={
                currentStep === item.step
                  ? "is-current"
                  : result && currentStep > item.step
                    ? "is-complete"
                    : ""
              }
            >
              <button
                type="button"
                onClick={() => moveToStep(item.step)}
                disabled={(item.step === 2 || item.step === 3 || item.step === 4) && !result}
                aria-current={currentStep === item.step ? "step" : undefined}
              >
                <span>{currentStep > item.step ? <CheckCircle2 size={17} /> : item.step}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>

        {currentStep === 1 && <section className="workspace-step-intro" aria-labelledby="input-step-title">
          <div>
            <p className="panel-kicker">1단계 · 자료 입력</p>
            <h1 id="input-step-title">공지로 만들 메일과 첨부파일을 넣어 주세요</h1>
            <p>본문을 붙여넣거나 EML, PDF, Word, Excel, 이미지 파일을 추가하면 다음 단계에서 핵심 정보와 원문 근거를 검토합니다.</p>
          </div>
          <div className="workspace-step-status">
            <span>{uploads.length ? `파일 ${uploads.length}개 추가됨` : "파일 추가 전"}</span>
            <strong>{isProcessing ? "첨부파일 처리 중" : isAnalyzing ? "AI 분석 중" : "입력 준비"}</strong>
          </div>
        </section>}

        {currentStep === 1 && <section className="input-workspace step-stage" id="input" aria-label="메일과 첨부파일 입력">
          <div className="input-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">직접 입력</p>
                <h2>이메일 본문</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => setMailText(sampleMail)}>
                샘플 넣기
              </button>
            </div>
            <textarea
              value={mailText}
              onChange={(event) => {
                setMailText(event.target.value);
                setAnalysis(null);
                setLoadedResult(null);
              }}
              placeholder="외부 공고 또는 공유 메일 내용을 붙여넣어 주세요. 클립보드의 이미지도 붙여넣을 수 있습니다."
              aria-label="공유 메일 본문 입력"
            />
          </div>

          <div className="upload-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">파일 입력</p>
                <h2>이미지·첨부파일</h2>
              </div>
              <span className="file-count">{uploads.length}/{MAX_FILES}</span>
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              onChange={handleFileChange}
            />
            <div
              className={isDragging ? "drop-zone is-dragging" : "drop-zone"}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={28} />
              <strong>파일을 끌어놓거나 클릭해 선택</strong>
              <span>EML, PDF, DOCX, XLSX, PNG, JPG, HEIC · 파일당 최대 20MB</span>
            </div>

            {uploads.length > 0 && (
              <div className="upload-list" aria-label="업로드 파일 처리 상태">
                {uploads.map((upload) => (
                  <UploadRow
                    key={upload.id}
                    upload={upload}
                    onPreview={upload.previewUrl ? () => setImagePreview({ fileName: upload.fileName, url: upload.previewUrl || "" }) : undefined}
                    onRemove={removeUpload}
                  />
                ))}
              </div>
            )}
          </div>
        </section>}

        {currentStep === 1 && isAnalyzing && (
          <section className="ai-waiting-card" aria-label="AI 분석 대기 상태" role="status">
            <div className="ai-orbit" aria-hidden="true">
              <span />
              <Sparkles size={24} />
            </div>
            <div className="ai-waiting-copy">
              <p className="panel-kicker">AI 분석 중</p>
              <h2>메일과 첨부파일을 함께 읽고 있어요</h2>
              <p>
                핵심 정보, 기간, 신청 방법, 문의처를 비교하면서 공지 초안에 들어갈 내용을 정리하는 중입니다.
              </p>
              <div className="ai-waiting-steps" aria-label="분석 진행 단계">
                <span className="is-active">자료 확인</span>
                <span>정보 추출</span>
                <span>초안 준비</span>
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="error-message global-error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {currentStep === 1 && <div className="primary-actions step-actions">
          <button className="primary-button" type="button" onClick={handleGenerate} disabled={isProcessing || isAnalyzing}>
            {isProcessing || isAnalyzing ? <LoaderCircle className="spin" size={18} /> : <FileText size={18} />}
            {isProcessing ? "파일 처리 중" : isAnalyzing ? "AI 분석 중" : "내용 정리하고 다음"}
            {!isProcessing && !isAnalyzing && <ArrowRight size={18} />}
          </button>
          <button className="secondary-button" type="button" onClick={handleReset}>
            <RefreshCcw size={18} />
            모두 지우기
          </button>
        </div>}

        {(currentStep === 2 || currentStep === 3 || currentStep === 4) && <section className="result-panel full-result step-stage" id="result">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">
                {currentStep === 2
                  ? "2단계 · 정보 검토"
                  : currentStep === 3
                    ? "3단계 · 초안 작성"
                    : "4단계 · 이미지 제작"}
              </p>
              <h2>
                {currentStep === 2
                  ? "추출 정보와 원문 근거"
                  : currentStep === 3
                    ? "채널별 공지 초안"
                    : "홍보 이미지 만들기"}
              </h2>
            </div>
            <span className="status-pill">
              {currentStep === 2 ? "검토 필요" : currentStep === 3 ? "게시 준비" : "이미지 준비"}
            </span>
          </div>

          {result ? (
            <>
              {currentStep === 2 && <>
                <div className="review-workspace">
                  <div className="review-summary" aria-label="추출 정보">
                    <h3 className="review-column-title">추출 정보</h3>
                    {descriptionField && (
                      <ProgramDescription field={descriptionField} onChange={updateField} />
                    )}
                    <div className="info-grid" aria-label="추출된 핵심 정보">
                      {analysis
                        ? analysis.fields.filter((field) => field.key !== "description").map((field) => (
                            <EditableInfo key={field.key} field={field} onChange={updateField} />
                          ))
                        : (Object.entries(result) as Array<[ExtractedKey, string]>).filter(([key]) => key !== "description").map(([key, value]) => (
                            <EditableInfo
                              key={key}
                              field={{
                                key,
                                label: fieldLabels[key],
                                value,
                                confidence: value ? 1 : 0,
                                sourceName: "",
                                evidence: "",
                                candidates: [],
                                hasConflict: false,
                              }}
                              onChange={updateField}
                            />
                          ))}
                    </div>

                    <div className={missingItems.length ? "missing-box" : "complete-box"}>
                      {missingItems.length ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                      <span>
                        {missingItems.length
                          ? `누락 가능 항목: ${missingItems.join(", ")}. 원문 확인 후 입력해 주세요.`
                          : "필수 항목이 모두 감지되었습니다. 각 근거와 내용을 확인해 주세요."}
                      </span>
                    </div>
                  </div>

                  <div className="review-evidence" aria-label="출처와 원문 근거">
                    <div className="evidence-box">
                      <h3>필드별 출처와 근거</h3>
                      {analysis ? (
                        <div className="evidence-list">
                          {analysis.fields.map((field) => (
                            <EvidenceItem key={field.key} field={field} />
                          ))}
                        </div>
                      ) : (
                        <ul>
                          {evidenceItems.map((item) => (
                            <li key={`${item.label}-${item.source}`}>
                              <strong>{item.label}</strong>
                              <span>{item.source}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {analysis && (analysis.links.length > 0 || analysis.qrCodes.length > 0) && (
                      <div className="link-box">
                        <h3>링크와 QR 코드</h3>
                        <ul>
                          {analysis.links.map((link) => (
                            <li key={link}>
                              <ExternalLink size={16} />
                              <span>{describeLink(link, analysis)}</span>
                              <a href={link} target="_blank" rel="noreferrer">{link}</a>
                            </li>
                          ))}
                          {analysis.qrCodes
                            .filter((code) => !analysis.links.includes(code))
                            .map((code) => (
                              <li key={code}>
                                <QrCode size={16} />
                                <span>QR 링크</span>
                                <span>{code}</span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </>}

              {(currentStep === 3 || currentStep === 4) && post && channelDrafts && draftTexts && (
                <div className="draft-box">
                  {currentStep === 3 && <>
                    <div className="draft-heading">
                    <div>
                      <p className="panel-kicker">채널별 초안</p>
                      <h3>{channelLabels[activeChannel]} 게시용 글</h3>
                    </div>
                    <div className="draft-actions">
                      <button className="secondary-button" type="button" onClick={handleSave} disabled={isSaving}>
                        <Save size={18} />
                        {user ? (isSaving ? "저장 중" : "공지 저장") : "로그인 후 저장"}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={handleCopy}
                        disabled={!copyReviewConfirmed}
                        aria-label={`${channelLabels[activeChannel]} 초안 복사`}
                      >
                        <Clipboard size={18} />
                      {copyState}
                      </button>
                    </div>
                  </div>
                  <div className="channel-tabs" role="tablist" aria-label="초안 채널 선택">
                    <ChannelTab channel="homepage" activeChannel={activeChannel} icon={<Monitor size={18} />} onSelect={handleChannelSelect} />
                    <ChannelTab channel="sns" activeChannel={activeChannel} icon={<Hash size={18} />} onSelect={handleChannelSelect} />
                    <ChannelTab channel="message" activeChannel={activeChannel} icon={<MessageCircle size={18} />} onSelect={handleChannelSelect} />
                  </div>
                  <div className={user ? "save-feedback is-signed-in" : "save-feedback is-guest"} role="status">
                    <Save size={16} />
                    <span>
                      {saveMessage ||
                        (user
                          ? "저장하면 저장된 공지 목록에 추가됩니다."
                          : "비로그인 상태에서는 공지가 저장되지 않습니다. 로그인 후 계정별로 저장할 수 있습니다.")}
                    </span>
                  </div>
                  <label className="review-check" htmlFor={`copy-review-${activeChannel}`}>
                    <input
                      id={`copy-review-${activeChannel}`}
                      type="checkbox"
                      checked={copyReviewConfirmed}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setCopyReviewConfirmed(checked);
                        persistSessionNow({ copyReviewConfirmed: checked });
                        setCopyState(`${channelLabels[activeChannel]} 초안 복사`);
                      }}
                    />
                    <span>
                      <strong>복사 전 확인</strong>
                      대상, 기간, 혜택, 신청 방법과 링크를 검토했고 현재 초안을 게시 담당자가 확인했습니다.
                    </span>
                  </label>
                  <div
                    className="draft-editor-panel"
                    role="tabpanel"
                    aria-label={`${channelLabels[activeChannel]} 초안 편집`}
                  >
                    <label htmlFor={`draft-editor-${activeChannel}`}>
                      <strong>초안 내용</strong>
                      <span>{draftTexts[activeChannel].length}자 · 바로 수정 가능</span>
                    </label>
                    <textarea
                      id={`draft-editor-${activeChannel}`}
                      className="draft-editor"
                      value={draftTexts[activeChannel]}
                      onInput={(event) => handleDraftChange(event.currentTarget.value)}
                      spellCheck
                    />
                    <p>수정한 내용이 복사할 초안에 바로 반영됩니다. 게시 전 원문 근거는 정보 검토 단계에서 확인해 주세요.</p>
                  </div>
                  </>}
                  {currentStep === 4 && imageDraft && (
                    <div className="image-maker">
                      <div className="image-maker-heading">
                        <div>
                          <p className="panel-kicker">이미지 제작</p>
                          <h3>초안을 홍보 이미지로 만들기</h3>
                        </div>
                        <button
                          className="image-download-button"
                          type="button"
                          onClick={handleImageDownload}
                          disabled={!user}
                        >
                          <Download size={18} />
                          {user ? "PNG 이미지 저장" : "로그인 후 저장"}
                        </button>
                      </div>
                      <div className="image-workspace">
                        <ImageDraftPreview draft={imageDraft} />
                        <div className="image-guide">
                          <strong>1080 x 1350 PNG</strong>
                          <span>모집·혜택과 필수 안내 정보를 한 장에 담은 홍보용 4:5 이미지입니다.</span>
                          <span>이미지 저장 전 추출 정보와 편집한 문구를 한 번 더 확인해 주세요.</span>
                          {imageStatus && <em role="status">{imageStatus}</em>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <Lightbulb size={28} />
              <p>메일 본문이나 첨부파일을 추가한 뒤 전체 내용 정리하기를 눌러 주세요.</p>
            </div>
          )}
          {result && currentStep === 2 && (
            <div className="step-actions">
              <button className="secondary-button" type="button" onClick={() => moveToStep(1)}>
                <ArrowLeft size={18} />
                이전
              </button>
              <button className="primary-button" type="button" onClick={() => moveToStep(3)}>
                초안 확인하기
                <ArrowRight size={18} />
              </button>
            </div>
          )}
          {result && currentStep === 3 && (
            <div className="step-actions">
              <button className="secondary-button" type="button" onClick={() => moveToStep(2)}>
                <ArrowLeft size={18} />
                검토로 돌아가기
              </button>
              <button className="primary-button" type="button" onClick={handleOpenImageStep}>
                {user ? "이미지 제작하기" : "로그인 후 이미지 제작"}
                <ArrowRight size={18} />
              </button>
            </div>
          )}
          {result && currentStep === 4 && (
            <div className="step-actions">
              <button className="secondary-button" type="button" onClick={() => moveToStep(3)}>
                <ArrowLeft size={18} />
                초안으로 돌아가기
              </button>
              <button className="primary-button" type="button" onClick={() => moveToStep(5)}>
                저장 공지 보기
                <ArrowRight size={18} />
              </button>
            </div>
          )}
        </section>}

        {currentStep === 5 && <section className="history-section step-stage" id="history" aria-label="저장된 공지">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">로그인 기반 기억</p>
              <h2>저장된 공지</h2>
            </div>
            <span className="status-pill">{user ? `${savedNotices.length}개 저장됨` : "로그인 필요"}</span>
          </div>

          {historyMessage && (
            <div className="history-message">
              <span>{historyMessage}</span>
            </div>
          )}

          {!user ? (
            <div className="empty-state compact">
              <p>로그인하면 생성한 공지 초안을 사용자별로 저장할 수 있습니다.</p>
            </div>
          ) : savedNotices.length ? (
            <div className="history-list">
              {savedNotices.map((notice) => (
                <article className="history-card" key={notice.id}>
                  <div>
                    <span>{new Date(notice.createdAtMs).toLocaleString("ko-KR")}</span>
                    <h3>{notice.title}</h3>
                    <p>{notice.category}</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => handleLoadSavedNotice(notice)}>
                    불러오기
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <p>아직 저장된 공지가 없습니다. 공지 초안을 만든 뒤 저장 버튼을 눌러 주세요.</p>
            </div>
          )}
          <div className="step-actions">
            <button className="secondary-button" type="button" onClick={() => moveToStep(result ? 4 : 1)}>
              <ArrowLeft size={18} />
              {result ? "이미지 제작으로 돌아가기" : "자료 입력으로"}
            </button>
            <button className="primary-button" type="button" onClick={handleReset}>
              새 공지 시작
              <ArrowRight size={18} />
            </button>
          </div>
        </section>}
      </div>
      </>}
      {imagePreview && (
        <div className="image-preview-modal" role="dialog" aria-modal="true" aria-label={`${imagePreview.fileName} 미리보기`} onClick={() => setImagePreview(null)}>
          <div className="image-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="image-preview-head">
              <strong>{imagePreview.fileName}</strong>
              <button type="button" className="remove-file" onClick={() => setImagePreview(null)} aria-label="이미지 미리보기 닫기">
                <X size={18} />
              </button>
            </div>
            <img src={imagePreview.url} alt={`${imagePreview.fileName} 미리보기`} />
          </div>
        </div>
      )}
    </main>
  );
}

function AuthPanel({
  authReady,
  user,
  onLogin,
  onLogout,
}: {
  authReady: boolean;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  if (!authReady) return <span className="auth-loading">로그인 확인 중</span>;

  if (!user) {
    return (
      <button className="auth-button" type="button" onClick={onLogin}>
        <GoogleIcon />
        <span>Google로 로그인</span>
      </button>
    );
  }

  return (
    <div className="auth-panel">
      {user.photoURL && <img src={user.photoURL} alt="" />}
      <div>
        <strong>{user.displayName || "로그인 사용자"}</strong>
        <span>{user.email}</span>
      </div>
      <button className="auth-icon-button" type="button" onClick={onLogout} aria-label="로그아웃">
        <LogOut size={18} />
      </button>
    </div>
  );
}

function describeLink(link: string, analysis: AnalysisResult) {
  const applyField = analysis.fields.find((field) => field.key === "applyMethod");
  if (applyField?.value.includes(link)) return "신청 링크";
  if (analysis.qrCodes.includes(link)) return "QR 링크";
  if (/forms\.gle|docs\.google\.com\/forms|form/i.test(link)) return "신청 링크";
  return "참고 링크";
}

function GoogleIcon() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function UploadRow({
  upload,
  onPreview,
  onRemove,
}: {
  upload: UploadItem;
  onPreview?: () => void;
  onRemove: (id: string) => void;
}) {
  const Icon = upload.fileName.toLowerCase().endsWith(".eml")
    ? Mail
    : /\.(png|jpe?g|webp|bmp|heic|heif)$/i.test(upload.fileName)
      ? ImageIcon
      : /\.(docx|xlsx|pdf)$/i.test(upload.fileName)
        ? FileArchive
        : Paperclip;
  const warningCount = upload.sources.reduce((sum, source) => sum + source.warnings.length, 0);
  return (
    <div className={`upload-row is-${upload.status}`}>
      <Icon size={20} />
      <div className="upload-meta">
        <div><strong>{upload.fileName}</strong><span>{formatBytes(upload.size)}</span></div>
        <span className="upload-message">{upload.error || upload.message}{warningCount ? ` · 경고 ${warningCount}건` : ""}</span>
        {(upload.status === "processing" || upload.status === "queued") && (
          <div className="progress-track"><span style={{ width: `${upload.progress}%` }} /></div>
        )}
      </div>
      {upload.status === "done" && <CheckCircle2 className="success-icon" size={19} />}
      {upload.status === "error" && <AlertTriangle className="error-icon" size={19} />}
      {onPreview && (
        <button type="button" className="preview-file" onClick={onPreview} aria-label={`${upload.fileName} 이미지 보기`}>
          <ImageIcon size={16} />
          <span>보기</span>
        </button>
      )}
      <button type="button" className="remove-file" onClick={() => onRemove(upload.id)} aria-label={`${upload.fileName} 제거`}>
        <X size={17} />
      </button>
    </div>
  );
}

function ProgramDescription({ field, onChange }: { field: DetailedField; onChange: (key: ExtractedKey, value: string) => void }) {
  const confidenceLabel = field.confidence >= 0.8 ? "높음" : field.confidence >= 0.6 ? "보통" : "낮음";
  return (
    <label className={`program-description-box ${field.value ? "" : "is-missing"}`}>
      <span>{field.label}</span>
      <textarea
        value={field.value}
        onChange={(event) => onChange(field.key, event.target.value)}
        placeholder="프로그램의 목적과 내용을 공지 문체로 정리해 주세요."
        rows={5}
      />
      <small className={`confidence confidence-${confidenceLabel}`}>신뢰도 {field.value ? confidenceLabel : "없음"}</small>
    </label>
  );
}

function EditableInfo({ field, onChange }: { field: DetailedField; onChange: (key: ExtractedKey, value: string) => void }) {
  const confidenceLabel = field.confidence >= 0.8 ? "높음" : field.confidence >= 0.6 ? "보통" : "낮음";
  return (
    <label className={`info-card ${field.value ? "" : "is-missing"}`}>
      <span>{field.label}</span>
      <input value={field.value} onChange={(event) => onChange(field.key, event.target.value)} placeholder="담당자 확인 필요" />
      <small className={`confidence confidence-${confidenceLabel}`}>신뢰도 {field.value ? confidenceLabel : "없음"}</small>
    </label>
  );
}

function EvidenceItem({ field }: { field: DetailedField }) {
  const alternatives = [...new Map(field.candidates.map((candidate) => [candidate.value, candidate])).values()]
    .filter((candidate) => candidate.value !== field.value);
  return (
    <article className="evidence-item">
      <div className="evidence-head">
        <strong>{field.label}</strong>
        {!field.sourceName ? (
          <span>근거 없음</span>
        ) : field.sourceName !== "직접 입력한 메일 본문" ? (
          <span>{field.sourceName}{field.page ? ` · ${field.page}페이지` : ""}</span>
        ) : null}
      </div>
      <div className="evidence-detail">
        <blockquote>{field.evidence || "원문에서 해당 정보를 찾지 못했습니다."}</blockquote>
        {alternatives.length > 0 && (
          <div className="alternative-values">
            <strong>다른 후보</strong>
            {alternatives.map((candidate) => (
              <span key={`${candidate.sourceId}-${candidate.value}`}>
                {candidate.value} - {candidate.sourceName}{candidate.page ? ` ${candidate.page}페이지` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ChannelTab({
  channel,
  activeChannel,
  icon,
  onSelect,
}: {
  channel: Channel;
  activeChannel: Channel;
  icon: ReactNode;
  onSelect: (channel: Channel) => void;
}) {
  const isActive = channel === activeChannel;
  return (
    <button className={isActive ? "channel-tab is-active" : "channel-tab"} type="button" role="tab" aria-selected={isActive} onClick={() => onSelect(channel)}>
      {icon}<span>{channelLabels[channel]}</span>
    </button>
  );
}

function ImageDraftPreview({ draft }: { draft: ImageDraft }) {
  return (
    <div className="visual-card is-promotional" aria-label="홍보용 이미지 미리보기">
      <div className="visual-card-brand">
        <strong>KNU</strong>
        <span>KANGNAM UNIVERSITY</span>
        <small>{draft.channelLabel} IMAGE</small>
      </div>
      <p className="visual-card-kicker">{draft.category}</p>
      <h4>{draft.title}</h4>
      <p className="visual-card-audience">대상 · {draft.audience}</p>
      <div className="visual-card-highlight">
        <span>주요 혜택</span>
        <strong>{draft.benefit}</strong>
      </div>
      <dl>
        <div><dt>기간</dt><dd>{draft.period}</dd></div>
        <div><dt>신청</dt><dd>{draft.applyMethod}</dd></div>
      </dl>
      <footer>문의 · {draft.contact}</footer>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default App;
