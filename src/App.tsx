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
  type ImageTemplate,
} from "./imageDraft";
import { loadNoticeDrafts, saveNoticeDraft, type SavedNotice } from "./noticeHistory";

type Channel = "homepage" | "sns" | "message";
type UploadStatus = "queued" | "processing" | "done" | "error";
type ChannelDraftTexts = Record<Channel, string>;

type UploadItem = {
  id: string;
  fileName: string;
  size: number;
  status: UploadStatus;
  progress: number;
  message: string;
  error?: string;
  sources: ProcessedSource[];
};

const channelLabels: Record<Channel, string> = {
  homepage: "홈페이지",
  sns: "SNS",
  message: "메시지",
};

function App() {
  const [mailText, setMailText] = useState(sampleMail);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loadedResult, setLoadedResult] = useState<ExtractedInfo | null>(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("홈페이지 초안 복사");
  const [draftTexts, setDraftTexts] = useState<ChannelDraftTexts | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel>("homepage");
  const [imageTemplate, setImageTemplate] = useState<ImageTemplate>("promotional");
  const [imageStatus, setImageStatus] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [savedNotices, setSavedNotices] = useState<SavedNotice[]>([]);
  const [historyMessage, setHistoryMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setHistoryMessage("");
      setSaveMessage("");

      if (!currentUser) {
        setSavedNotices([]);
        setSaveMessage("비로그인 상태입니다. 분석과 복사는 가능하지만 저장은 Google 로그인 후 사용할 수 있습니다.");
        return;
      }

      try {
        const notices = await loadNoticeDrafts(currentUser.uid);
        setSavedNotices(notices);
        setSaveMessage(`${currentUser.displayName || "로그인 사용자"} 계정으로 저장할 수 있습니다. 저장된 공지는 아래 목록에서 다시 불러옵니다.`);
      } catch {
        setHistoryMessage("저장된 공지를 불러오지 못했습니다. Firestore 설정을 확인해 주세요.");
      }
    });
  }, []);

  const allSources = useMemo(
    () => uploads.flatMap((upload) => upload.sources),
    [uploads],
  );
  const isProcessing = uploads.some(
    (upload) => upload.status === "processing" || upload.status === "queued",
  );
  const result = analysis?.info ?? loadedResult;
  const post = useMemo(() => (result ? buildHomepagePost(result) : null), [result]);
  const imageDraft = useMemo(
    () => (result ? buildImageDraft(result, channelLabels[activeChannel], imageTemplate) : null),
    [activeChannel, imageTemplate, result],
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

    setDraftTexts({
      homepage: channelDrafts.homepage,
      sns: channelDrafts.sns,
      message: channelDrafts.message,
    });
  }, [channelDrafts]);

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
      fileName: file.name,
      size: file.size,
      status: supportsFile(file) ? "queued" : "error",
      progress: 0,
      message: supportsFile(file) ? "처리 대기 중" : "지원하지 않는 파일 형식",
      error: supportsFile(file) ? undefined : "지원하지 않는 파일 형식입니다.",
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

  const handleGenerate = () => {
    setActiveChannel("homepage");
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
    setError("");
    setHistoryMessage("");
    setSaveMessage(user ? "분석 결과가 갱신되었습니다. 검토 후 저장하면 Firestore의 저장된 공지 목록에 추가됩니다." : "분석 결과가 갱신되었습니다. 비로그인 상태에서는 복사와 이미지 저장만 가능하고, 공지 저장은 로그인 후 가능합니다.");

    if (isProcessing) {
      setError("파일 처리가 끝난 뒤 내용을 정리해 주세요.");
      return;
    }
    if (!mailText.trim() && !allSources.some((source) => source.text.trim())) {
      setAnalysis(null);
      setLoadedResult(null);
      setError("메일 본문을 입력하거나 분석할 파일을 추가해 주세요.");
      return;
    }

    try {
      setLoadedResult(null);
      setAnalysis(analyzeSources(mailText, allSources));
    } catch {
      setAnalysis(null);
      setLoadedResult(null);
      setError("결과 생성에 실패했습니다. 파일 추출 결과와 메일 내용을 확인해 주세요.");
    }
  };

  const handleReset = () => {
    setMailText("");
    setUploads([]);
    setAnalysis(null);
    setLoadedResult(null);
    setError("");
    setHistoryMessage("");
    setSaveMessage(user ? "입력을 초기화했습니다. 새 공지를 만든 뒤 저장할 수 있습니다." : "입력을 초기화했습니다. 저장 기능은 Google 로그인 후 사용할 수 있습니다.");
    setActiveChannel("homepage");
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
  };

  const removeUpload = (id: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== id));
    setAnalysis(null);
    setLoadedResult(null);
  };

  const handleCopy = async () => {
    if (!draftTexts) return;
    try {
      await navigator.clipboard.writeText(draftTexts[activeChannel]);
      setCopyState(`${channelLabels[activeChannel]} 초안 복사됨`);
    } catch {
      setCopyState("복사 실패");
    }
  };

  const handleDraftChange = (value: string) => {
    setDraftTexts((drafts) => (drafts ? { ...drafts, [activeChannel]: value } : drafts));
    setCopyState(`${channelLabels[activeChannel]} 초안 복사`);
  };

  const handleChannelSelect = (channel: Channel) => {
    setActiveChannel(channel);
    setCopyState(`${channelLabels[channel]} 초안 복사`);
    setImageStatus("");
  };

  const handleImageDownload = async () => {
    if (!imageDraft) return;
    setImageStatus("이미지 만드는 중...");
    try {
      const fileName = await downloadImageDraft(imageDraft);
      setImageStatus(`${fileName} 저장 완료`);
    } catch {
      setImageStatus("이미지 저장에 실패했습니다.");
    }
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
  };

  const handleLogin = async () => {
    setHistoryMessage("");
    setSaveMessage("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setHistoryMessage("Google 로그인에 실패했습니다. Firebase Authentication 설정을 확인해 주세요.");
      setSaveMessage("로그인에 실패해 저장 기능을 사용할 수 없습니다. Firebase Authentication 설정을 확인해 주세요.");
    }
  };

  const handleLogout = async () => {
    setHistoryMessage("");
    setSaveMessage("로그아웃했습니다. 현재 화면의 분석/복사는 가능하지만 저장된 공지는 계정에 연결되지 않습니다.");
    await signOut(auth);
  };

  const handleSave = async () => {
    if (!user) {
      setHistoryMessage("로그인해야 공지를 저장할 수 있습니다.");
      setSaveMessage("저장하지 않았습니다. Google 로그인 후 저장하면 Firestore에 계정별 공지로 보관됩니다.");
      return;
    }
    if (!post || !result) {
      setSaveMessage("저장할 공지 초안이 없습니다. 먼저 전체 내용 정리하기를 실행해 주세요.");
      return;
    }

    setIsSaving(true);
    setHistoryMessage("");
    setSaveMessage("Firestore에 공지 초안을 저장하는 중입니다.");
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
      setHistoryMessage("공지 저장에 실패했습니다. Firestore 권한과 규칙을 확인해 주세요.");
      setSaveMessage("저장에 실패했습니다. Firestore 권한, 규칙, 네트워크 상태를 확인해 주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadSavedNotice = (notice: SavedNotice) => {
    setMailText(notice.sourceMail);
    setUploads([]);
    setAnalysis(null);
    setLoadedResult(notice.extractedInfo);
    setActiveChannel("homepage");
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
    setHistoryMessage("저장된 공지를 현재 작업 화면으로 불러왔습니다.");
    setSaveMessage("저장된 공지를 불러왔습니다. 수정 후 다시 저장하면 새 저장 항목으로 추가됩니다.");
  };

  return (
    <main>
      <header className="site-header">
        <div className="top-line">
          <span>KANGNAM UNIVERSITY</span>
          <span>공지 작성 지원</span>
        </div>
        <div className="brand-bar">
          <div className="brand-mark" aria-hidden="true">📣</div>
          <div>
            <strong>강남대학교</strong>
            <span>Kangnam University Notice Helper</span>
          </div>
          <nav aria-label="서비스 메뉴">
            <a href="#service">서비스소개</a>
            <a href="#input">자료입력</a>
            <a href="#result">추출결과</a>
            <a href="#history">저장공지</a>
          </nav>
          <AuthPanel authReady={authReady} user={user} onLogin={handleLogin} onLogout={handleLogout} />
        </div>
      </header>

      <div className="page-shell">
        <section className="hero" id="service">
          <div className="hero-intro">
            <p className="eyebrow">이메일·첨부파일 통합 공지 도우미</p>
            <h1>메일과 첨부파일의 핵심 정보를 한 번에</h1>
            <p className="hero-copy">
              이메일, 이미지, PDF, Word, Excel에서 내용을 추출하고 근거와 함께 채널별 공지 초안을 만듭니다.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#input">
                <FileText size={18} />
                공지 만들기
              </a>
              <a className="secondary-button" href="#result">
                <Sparkles size={18} />
                결과 미리보기
              </a>
            </div>
            <div className="hero-badges" aria-label="지원 입력 형식">
              <span>메일 본문</span>
              <span>PDF</span>
              <span>DOCX</span>
              <span>XLSX</span>
              <span>이미지</span>
              <span>붙여넣기</span>
            </div>
          </div>
          <div className="landing-preview" aria-label="공지 변환 예시">
            <div className="preview-mail">
              <span>예시 메일</span>
              <strong>2026 비교과 프로그램 신청 안내</strong>
              <p>대상, 기간, 혜택, 신청 링크가 흩어진 메일과 첨부파일을 함께 분석합니다.</p>
            </div>
            <div className="preview-result-grid">
              <div><span>대상</span><strong>재학생</strong></div>
              <div><span>기간</span><strong>7.29-8.9</strong></div>
              <div><span>혜택</span><strong>마일리지</strong></div>
              <div><span>신청</span><strong>온라인 링크</strong></div>
            </div>
            <div className="preview-draft">
              <span>홈페이지 공지 초안</span>
              <p>[비교과] AI 역량 강화 프로그램 신청 안내</p>
            </div>
          </div>
        </section>

        <section className="mode-section" aria-label="로그인 상태별 기능 안내">
          <div className="mode-heading">
            <p className="panel-kicker">사용 상태</p>
            <h2>저장은 Google 로그인 후 Firestore에 보관됩니다</h2>
          </div>
          <div className="mode-grid">
            <div className={!user ? "mode-card is-active" : "mode-card"}>
              <span>비로그인·게스트</span>
              <strong>분석, 근거 확인, 초안 복사, PNG 저장 가능</strong>
              <p>공지 저장은 하지 않습니다. 저장 버튼을 누르면 로그인 안내가 표시됩니다.</p>
            </div>
            <div className={user ? "mode-card is-active" : "mode-card"}>
              <span>Google 로그인</span>
              <strong>Firestore에 계정별 공지 저장·불러오기 가능</strong>
              <p>저장된 공지는 화면 하단의 저장된 공지 목록에서 다시 불러옵니다.</p>
            </div>
            <div className="mode-card status-card">
              <span>현재 상태</span>
              <strong>{authReady ? (user ? "로그인됨 · 저장 가능" : "비로그인 · 저장 불가") : "로그인 상태 확인 중"}</strong>
              <p>{user ? `${user.email || user.displayName || "현재 계정"}에 연결된 공지로 저장됩니다.` : "Google 로그인 버튼을 누르면 저장 기능이 열립니다."}</p>
            </div>
          </div>
        </section>

        <div className="notice">
          <Sparkles size={20} />
          <span>
            파일은 서버에 업로드하지 않고 현재 브라우저에서 처리합니다. 저장 버튼은 직접 입력한 메일 본문과 최종 공지 초안만 Firestore에 저장합니다.
          </span>
        </div>

        <section className="input-workspace" id="input" aria-label="메일과 첨부파일 입력">
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
                  <UploadRow key={upload.id} upload={upload} onRemove={removeUpload} />
                ))}
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="error-message global-error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="primary-actions">
          <button className="primary-button" type="button" onClick={handleGenerate} disabled={isProcessing}>
            {isProcessing ? <LoaderCircle className="spin" size={18} /> : <FileText size={18} />}
            {isProcessing ? "파일 처리 중" : "전체 내용 정리하기"}
          </button>
          <button className="secondary-button" type="button" onClick={handleReset}>
            <RefreshCcw size={18} />
            모두 지우기
          </button>
        </div>

        <section className="result-panel full-result" id="result">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">검토 가능한 결과</p>
              <h2>추출 정보와 원문 근거</h2>
            </div>
            <span className="status-pill">{result ? "검토 필요" : "대기 중"}</span>
          </div>

          {result ? (
            <>
              <div className="info-grid" aria-label="추출된 핵심 정보">
                {analysis
                  ? analysis.fields.map((field) => (
                      <EditableInfo key={field.key} field={field} onChange={updateField} />
                    ))
                  : (Object.entries(result) as Array<[ExtractedKey, string]>).map(([key, value]) => (
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
                    : "필수 항목이 모두 감지되었습니다. 각 근거와 충돌 여부를 확인해 주세요."}
                </span>
              </div>

              {analysis?.conflicts.length ? (
                <div className="conflict-box">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>서로 다른 정보가 발견되었습니다.</strong>
                    <span>{analysis.conflicts.map((field) => field.label).join(", ")} 항목의 후보를 비교해 주세요.</span>
                  </div>
                </div>
              ) : null}

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
                        <a href={link} target="_blank" rel="noreferrer">{link}</a>
                      </li>
                    ))}
                    {analysis.qrCodes
                      .filter((code) => !analysis.links.includes(code))
                      .map((code) => (
                        <li key={code}>
                          <QrCode size={16} />
                          <span>{code}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {post && channelDrafts && draftTexts && (
                <div className="draft-box">
                  <div className="draft-heading">
                    <div>
                      <p className="panel-kicker">채널별 초안</p>
                      <h3>{channelLabels[activeChannel]} 게시용 글</h3>
                    </div>
                    <div className="draft-actions">
                      <button className="secondary-button" type="button" onClick={handleSave} disabled={isSaving}>
                        <Save size={18} />
                        {user ? (isSaving ? "저장 중" : "Firestore 저장") : "로그인 후 저장"}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={handleCopy}
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
                          ? "저장하면 Firestore의 저장된 공지 목록에 추가됩니다."
                          : "비로그인 상태에서는 공지가 저장되지 않습니다. Google 로그인 후 계정별로 저장할 수 있습니다.")}
                    </span>
                  </div>
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
                      onChange={(event) => handleDraftChange(event.target.value)}
                      spellCheck
                    />
                    <p>수정한 내용이 복사할 초안에 바로 반영됩니다. 게시 전 원문 근거는 위 항목에서 확인해 주세요.</p>
                  </div>
                  {imageDraft && (
                    <div className="image-maker">
                      <div className="image-maker-heading">
                        <div>
                          <p className="panel-kicker">이미지 제작</p>
                          <h3>초안을 홍보·안내 이미지로 만들기</h3>
                        </div>
                        <button
                          className="image-download-button"
                          type="button"
                          onClick={handleImageDownload}
                        >
                          <Download size={18} />
                          PNG 이미지 저장
                        </button>
                      </div>
                      <div className="image-template-tabs" aria-label="이미지 유형 선택">
                        <button
                          type="button"
                          aria-pressed={imageTemplate === "promotional"}
                          className={imageTemplate === "promotional" ? "is-active" : ""}
                          onClick={() => {
                            setImageTemplate("promotional");
                            setImageStatus("");
                          }}
                        >
                          <ImageIcon size={18} />
                          <span><strong>홍보용</strong><small>모집·혜택 중심</small></span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={imageTemplate === "informational"}
                          className={imageTemplate === "informational" ? "is-active" : ""}
                          onClick={() => {
                            setImageTemplate("informational");
                            setImageStatus("");
                          }}
                        >
                          <FileText size={18} />
                          <span><strong>안내용</strong><small>정보 확인 중심</small></span>
                        </button>
                      </div>
                      <div className="image-workspace">
                        <ImageDraftPreview draft={imageDraft} />
                        <div className="image-guide">
                          <strong>1080 x 1350 PNG</strong>
                          <span>SNS 피드와 모바일 안내에 적합한 4:5 비율입니다.</span>
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
        </section>

        <section className="history-section" id="history" aria-label="저장된 공지">
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
              <p>Google 로그인하면 생성한 공지 초안을 사용자별로 저장할 수 있습니다.</p>
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
        </section>
      </div>
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

function UploadRow({ upload, onRemove }: { upload: UploadItem; onRemove: (id: string) => void }) {
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
      <button type="button" className="remove-file" onClick={() => onRemove(upload.id)} aria-label={`${upload.fileName} 제거`}>
        <X size={17} />
      </button>
    </div>
  );
}

function EditableInfo({ field, onChange }: { field: DetailedField; onChange: (key: ExtractedKey, value: string) => void }) {
  const confidenceLabel = field.confidence >= 0.8 ? "높음" : field.confidence >= 0.6 ? "보통" : "낮음";
  return (
    <label className={`info-card ${field.value ? "" : "is-missing"} ${field.hasConflict ? "has-conflict" : ""}`}>
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
    <details className={field.hasConflict ? "evidence-item has-conflict" : "evidence-item"} open={field.hasConflict}>
      <summary>
        <strong>{field.label}</strong>
        <span>{field.sourceName ? `${field.sourceName}${field.page ? ` · ${field.page}페이지` : ""}` : "근거 없음"}</span>
      </summary>
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
    </details>
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
    <div className={`visual-card is-${draft.template}`} aria-label={`${draft.template === "promotional" ? "홍보용" : "안내용"} 이미지 미리보기`}>
      <div className="visual-card-brand">
        <strong>KNU</strong>
        <span>KANGNAM UNIVERSITY</span>
        <small>{draft.channelLabel} IMAGE</small>
      </div>
      <p className="visual-card-kicker">{draft.category}</p>
      <h4>{draft.title}</h4>
      <p className="visual-card-audience">대상 · {draft.audience}</p>
      {draft.template === "informational" && (
        <div className="visual-card-section-title"><span>한눈에 보는</span> 핵심 안내</div>
      )}
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
