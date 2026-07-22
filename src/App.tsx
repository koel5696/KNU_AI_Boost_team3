import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  FileText,
  Lightbulb,
  LogIn,
  LogOut,
  RefreshCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import {
  buildHomepagePost,
  extractInfo,
  sampleMail,
  type ExtractedInfo,
  type HomepagePost,
} from "./extractor";
import { auth, googleProvider } from "./firebase";
import { loadNoticeDrafts, saveNoticeDraft, type SavedNotice } from "./noticeHistory";

const infoLabels: Record<keyof ExtractedInfo, string> = {
  category: "유형",
  audience: "대상",
  period: "기간",
  benefit: "주요 혜택",
  applyMethod: "신청 방법",
  contact: "문의처",
};

function App() {
  const [mailText, setMailText] = useState(sampleMail);
  const [result, setResult] = useState<ExtractedInfo | null>(null);
  const [post, setPost] = useState<HomepagePost | null>(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("홈페이지 글 복사");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [savedNotices, setSavedNotices] = useState<SavedNotice[]>([]);
  const [historyMessage, setHistoryMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setHistoryMessage("");

      if (!currentUser) {
        setSavedNotices([]);
        return;
      }

      try {
        setSavedNotices(await loadNoticeDrafts(currentUser.uid));
      } catch {
        setHistoryMessage("저장된 공지를 불러오지 못했습니다. Firestore 설정을 확인해 주세요.");
      }
    });
  }, []);

  const missingItems = useMemo(() => {
    if (!result) return [];

    return Object.entries(result)
      .filter(([, value]) => !value)
      .map(([key]) => infoLabels[key as keyof ExtractedInfo]);
  }, [result]);

  const evidenceItems = useMemo(() => {
    if (!result) return [];

    const lines = mailText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return Object.entries(result)
      .filter(([, value]) => value)
      .map(([key, value]) => {
        const source = lines.find((line) => line.includes(value) || value.includes(line.replace(/[.?!]$/, "")));
        return {
          label: infoLabels[key as keyof ExtractedInfo],
          source: source || "원문에서 규칙 기반으로 감지",
        };
      });
  }, [mailText, result]);

  const handleGenerate = () => {
    setCopyState("홈페이지 글 복사");
    setReviewConfirmed(false);
    setError("");
    setHistoryMessage("");

    if (!mailText.trim()) {
      setResult(null);
      setPost(null);
      setError("메일 내용을 입력해 주세요. 공유 메일 본문이나 제목을 붙여 넣으면 예시 추출 결과를 만들 수 있습니다.");
      return;
    }

    try {
      const extracted = extractInfo(mailText);
      setResult(extracted);
      setPost(buildHomepagePost(extracted));
    } catch {
      setResult(null);
      setPost(null);
      setError("결과 생성에 실패했습니다. 메일 내용에 모집 대상, 기간, 신청 방법, 문의처가 포함되어 있는지 확인해 주세요.");
    }
  };

  const handleReset = () => {
    setMailText("");
    setResult(null);
    setPost(null);
    setError("");
    setHistoryMessage("");
    setCopyState("홈페이지 글 복사");
    setReviewConfirmed(false);
  };

  const handleCopy = async () => {
    if (!post) return;
    if (!reviewConfirmed) {
      setCopyState("확인 후 복사");
      return;
    }
    try {
      await navigator.clipboard.writeText(post.copyText);
      setCopyState("게시글 복사됨");
    } catch {
      setCopyState("복사 실패");
    }
  };

  const handleLogin = async () => {
    setHistoryMessage("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setHistoryMessage("Google 로그인에 실패했습니다. Firebase Authentication 설정을 확인해 주세요.");
    }
  };

  const handleLogout = async () => {
    setHistoryMessage("");
    await signOut(auth);
  };

  const handleSave = async () => {
    if (!user) {
      setHistoryMessage("로그인 후 공지를 저장할 수 있습니다.");
      return;
    }
    if (!post || !result) return;

    setIsSaving(true);
    setHistoryMessage("");
    try {
      const saved = await saveNoticeDraft({
        userId: user.uid,
        post,
        sourceMail: mailText,
        extractedInfo: result,
      });
      setSavedNotices((current) => [saved, ...current]);
      setHistoryMessage("현재 공지 초안을 저장했습니다.");
    } catch {
      setHistoryMessage("공지 저장에 실패했습니다. Firestore 권한과 규칙을 확인해 주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadSavedNotice = (notice: SavedNotice) => {
    setMailText(notice.sourceMail);
    setResult(notice.extractedInfo);
    setPost({
      title: notice.title,
      category: notice.category,
      body: notice.body,
      copyText: notice.copyText,
    });
    setReviewConfirmed(false);
    setCopyState("홈페이지 글 복사");
    setHistoryMessage("저장된 공지를 현재 작업 화면으로 불러왔습니다.");
  };

  return (
    <main>
      <header className="site-header">
        <div className="top-line">
          <span>KANGNAM UNIVERSITY</span>
          <span>공지 작성 지원</span>
        </div>
        <div className="brand-bar">
          <div className="brand-mark">KNU</div>
          <div>
            <strong>강남대학교</strong>
            <span>Kangnam University Notice Helper</span>
          </div>
          <nav aria-label="서비스 메뉴">
            <a href="#input">메일입력</a>
            <a href="#result">공지초안</a>
            <a href="#history">저장공지</a>
          </nav>
          <AuthPanel
            authReady={authReady}
            user={user}
            onLogin={handleLogin}
            onLogout={handleLogout}
          />
        </div>
      </header>

      <div className="page-shell">
        <section className="hero">
          <div>
            <p className="eyebrow">대학교 부서 공지 초안 도우미</p>
            <h1>공유 메일을 홈페이지 공지 초안으로 빠르게 정리</h1>
            <p className="hero-copy">
              행정, 홍보, 취업지원 담당자가 여러 공고 메일에서 핵심 정보를 확인하고 누락 항목을 바로 발견할 수 있는 1-Day P0 프로토타입입니다.
            </p>
          </div>
          <div className="notice">
            <Sparkles size={20} />
            <span>Google 로그인 후 생성한 공지 초안을 저장하고 다시 불러올 수 있습니다. Firebase 설정값은 로컬 환경변수에서만 읽습니다.</span>
          </div>
        </section>

        <section className="workspace" aria-label="메일 입력과 결과">
          <div className="input-panel">
            <div className="panel-heading" id="input">
              <div>
                <p className="panel-kicker">입력</p>
                <h2>공유 메일 본문</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => setMailText(sampleMail)}>
                샘플 넣기
              </button>
            </div>
            <textarea
              value={mailText}
              onChange={(event) => setMailText(event.target.value)}
              placeholder="외부 공고 또는 공유 메일 내용을 붙여 넣어 주세요."
              aria-label="공유 메일 본문 입력"
            />
            {error && (
              <div className="error-message" role="alert">
                <AlertTriangle size={18} />
                <span>{error}</span>
              </div>
            )}
            <div className="actions">
              <button className="primary-button" type="button" onClick={handleGenerate}>
                <FileText size={18} />
                메일 내용 정리하기
              </button>
              <button className="secondary-button" type="button" onClick={handleReset}>
                <RefreshCcw size={18} />
                다시 입력
              </button>
            </div>
          </div>

          <div className="result-panel">
            <div className="panel-heading" id="result">
              <div>
                <p className="panel-kicker">결과</p>
                <h2>추출 정보와 홈페이지 게시글</h2>
              </div>
              <span className="status-pill">{result ? "검토 필요" : "대기 중"}</span>
            </div>

            {result ? (
              <>
                <div className="info-grid" aria-label="추출된 핵심 정보">
                  <Info label="유형" value={result.category} />
                  <Info label="대상" value={result.audience} />
                  <Info label="기간" value={result.period} />
                  <Info label="주요 혜택" value={result.benefit} />
                  <Info label="신청 방법" value={result.applyMethod} />
                  <Info label="문의처" value={result.contact} />
                </div>

                <div className={missingItems.length ? "missing-box" : "complete-box"}>
                  {missingItems.length ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                  <span>
                    {missingItems.length
                      ? `누락 가능 항목: ${missingItems.join(", ")}. 원문 확인 후 보완해 주세요.`
                      : "필수 항목을 모두 감지했습니다. 게시 전 원문과 한 번 더 대조해 주세요."}
                  </span>
                </div>

                <div className="evidence-box">
                  <h3>결과 근거</h3>
                  <ul>
                    {evidenceItems.map((item) => (
                      <li key={`${item.label}-${item.source}`}>
                        <strong>{item.label}</strong>
                        <span>{item.source}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {post && (
                  <div className="draft-box">
                    <div className="draft-heading">
                      <h3>홈페이지 게시용 글</h3>
                      <div className="draft-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={handleSave}
                          disabled={isSaving}
                        >
                          <Save size={18} />
                          {isSaving ? "저장 중" : "저장"}
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={handleCopy}
                          disabled={!reviewConfirmed}
                          aria-label="홈페이지 게시글 복사"
                        >
                          <Clipboard size={18} />
                          {copyState}
                        </button>
                      </div>
                    </div>
                    <label className="review-check">
                      <input
                        type="checkbox"
                        checked={reviewConfirmed}
                        onChange={(event) => {
                          setReviewConfirmed(event.target.checked);
                          setCopyState("홈페이지 글 복사");
                        }}
                      />
                      <span>
                        <strong>게시 전 원문과 한 번 더 검증해 주세요.</strong>
                        원문과 비교하여 제목, 대상, 기간, 신청 방법, 문의처에 문제가 없음을 확인했습니다.
                      </span>
                    </label>
                    <div className="post-preview" aria-label="홈페이지 게시용 글 미리보기">
                      <div className="post-field">
                        <span>제목</span>
                        <strong>{post.title}</strong>
                      </div>
                      <div className="post-field">
                        <span>분류</span>
                        <strong>{post.category}</strong>
                      </div>
                      <pre>{post.body}</pre>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <Lightbulb size={28} />
                <p>메일 내용을 입력하고 정리 버튼을 누르면 유형, 대상, 기간, 신청 방법, 문의처와 홈페이지 게시용 글을 표시합니다.</p>
              </div>
            )}
          </div>
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
              <p>Google 로그인 후 생성한 공지 초안을 사용자별로 저장할 수 있습니다.</p>
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
  if (!authReady) {
    return <span className="auth-loading">로그인 확인 중</span>;
  }

  if (!user) {
    return (
      <button className="auth-button" type="button" onClick={onLogin}>
        <LogIn size={18} />
        Google 로그인
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className={value ? "info-card" : "info-card is-missing"}>
      <span>{label}</span>
      <strong>{value || "해당 항목 확인 필요"}</strong>
    </div>
  );
}

export default App;
