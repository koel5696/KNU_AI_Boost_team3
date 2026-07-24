import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  MessageCircle,
  Monitor,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import {
  buildHomepagePost,
  buildMessageDraft,
  buildSnsPost,
  extractInfo,
  sampleMail,
  type ExtractedInfo,
} from "./extractor";
import {
  buildImageDraft,
  downloadImageDraft,
  type ImageDraft,
  type ImageTemplate,
} from "./imageDraft";

type Channel = "homepage" | "sns" | "message";
type ChannelDrafts = Record<Channel, string>;

const channelLabels: Record<Channel, string> = {
  homepage: "홈페이지",
  sns: "SNS",
  message: "메시지",
};

function App() {
  const [mailText, setMailText] = useState(sampleMail);
  const [result, setResult] = useState<ExtractedInfo | null>(null);
  const [channelDrafts, setChannelDrafts] = useState<ChannelDrafts | null>(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("홈페이지 초안 복사");
  const [activeChannel, setActiveChannel] = useState<Channel>("homepage");
  const [imageTemplate, setImageTemplate] = useState<ImageTemplate>("promotional");
  const [imageStatus, setImageStatus] = useState("");

  const imageDraft = useMemo(
    () => result ? buildImageDraft(result, channelLabels[activeChannel], imageTemplate) : null,
    [activeChannel, imageTemplate, result],
  );

  const missingItems = useMemo(() => {
    if (!result) return [];
    const labels: Record<keyof ExtractedInfo, string> = {
      category: "유형",
      audience: "대상",
      period: "기간",
      benefit: "주요 혜택",
      applyMethod: "신청 방법",
      contact: "문의처",
    };

    return Object.entries(result)
      .filter(([, value]) => !value)
      .map(([key]) => labels[key as keyof ExtractedInfo]);
  }, [result]);

  const evidenceItems = useMemo(() => {
    if (!result) return [];
    const labels: Record<keyof ExtractedInfo, string> = {
      category: "유형",
      audience: "대상",
      period: "기간",
      benefit: "주요 혜택",
      applyMethod: "신청 방법",
      contact: "문의처",
    };
    const lines = mailText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return Object.entries(result)
      .filter(([, value]) => value)
      .map(([key, value]) => {
        const source = lines.find((line) => line.includes(value) || value.includes(line.replace(/[.。]$/, "")));
        return {
          label: labels[key as keyof ExtractedInfo],
          source: source || "원문에서 규칙 기반으로 감지됨",
        };
      });
  }, [mailText, result]);

  const handleGenerate = () => {
    setActiveChannel("homepage");
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
    setError("");

    if (!mailText.trim()) {
      setResult(null);
      setChannelDrafts(null);
      setError("메일 내용을 입력해 주세요. 공유 메일 본문이나 제목을 붙여넣으면 예시 추출 결과를 만들 수 있습니다.");
      return;
    }

    try {
      const extracted = extractInfo(mailText);
      const homepage = buildHomepagePost(extracted);
      const sns = buildSnsPost(extracted);
      const message = buildMessageDraft(extracted);
      setResult(extracted);
      setChannelDrafts({
        homepage: homepage.copyText,
        sns: sns.copyText,
        message: message.copyText,
      });
    } catch {
      setResult(null);
      setChannelDrafts(null);
      setError("결과 생성에 실패했습니다. 메일 내용에 모집 대상, 기간, 신청 방법, 문의처가 포함되어 있는지 확인해 주세요.");
    }
  };

  const handleReset = () => {
    setMailText("");
    setResult(null);
    setChannelDrafts(null);
    setError("");
    setActiveChannel("homepage");
    setCopyState("홈페이지 초안 복사");
    setImageStatus("");
  };

  const handleCopy = async () => {
    if (!channelDrafts) return;
    try {
      await navigator.clipboard.writeText(channelDrafts[activeChannel]);
      setCopyState(`${channelLabels[activeChannel]} 초안 복사됨`);
    } catch {
      setCopyState("복사 실패");
    }
  };

  const handleDraftChange = (value: string) => {
    setChannelDrafts((drafts) => drafts ? { ...drafts, [activeChannel]: value } : drafts);
    setCopyState(`${channelLabels[activeChannel]} 초안 복사`);
  };

  const handleChannelSelect = (channel: Channel) => {
    setActiveChannel(channel);
    setCopyState(`${channelLabels[channel]} 초안 복사`);
    setImageStatus("");
  };

  const handleImageTemplateSelect = (template: ImageTemplate) => {
    setImageTemplate(template);
    setImageStatus("");
  };

  const handleImageDownload = async () => {
    if (!imageDraft) return;
    setImageStatus("이미지 만드는 중…");
    try {
      const fileName = await downloadImageDraft(imageDraft);
      setImageStatus(`${fileName} 저장 완료`);
    } catch {
      setImageStatus("이미지 저장에 실패했습니다.");
    }
  };

  return (
    <main>
      <header className="site-header">
        <div className="top-line">
          <span>KANGNAM UNIVERSITY</span>
          <span>공지 작성 지원</span>
        </div>
        <div className="brand-bar">
          <div className="brand-mark" role="img" aria-label="공지 알리미">📢</div>
          <div>
            <strong>강남대학교</strong>
            <span>Kangnam University Notice Helper</span>
          </div>
          <nav aria-label="서비스 메뉴">
            <a href="#input">메일입력</a>
            <a href="#result">공지초안</a>
            <a href="#feedback">검토질문</a>
          </nav>
        </div>
      </header>

      <div className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">대학교 부서 공지 초안 도우미</p>
          <h1>공유 메일 하나로 채널별 공지 초안을 한 번에</h1>
          <p className="hero-copy">
            외부 공고 메일에서 핵심 정보를 확인하고 홈페이지, SNS, 메시지에 맞는 초안을 바로 만들어 보세요.
          </p>
        </div>
        <div className="notice">
          <Sparkles size={20} />
          <span>실제 AI 연동 없이 규칙과 샘플 기반으로 만든 예시 결과입니다. 브라우저에는 API 키가 없습니다.</span>
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
            placeholder="외부 공고 또는 공유 메일 내용을 붙여넣어 주세요."
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
              <h2>추출 정보와 채널별 공지 초안</h2>
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
                    : "필수 항목이 모두 감지되었습니다. 게시 전 원문과 한 번 더 대조해 주세요."}
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

              {channelDrafts && (
                <div className="draft-box">
                <div className="draft-heading">
                  <div>
                    <p className="panel-kicker">채널별 초안</p>
                    <h3>{channelLabels[activeChannel]} 게시용 글</h3>
                  </div>
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
                <div className="channel-tabs" role="tablist" aria-label="초안 채널 선택">
                  <ChannelTab channel="homepage" activeChannel={activeChannel} icon={<Monitor size={18} />} onSelect={handleChannelSelect} />
                  <ChannelTab channel="sns" activeChannel={activeChannel} icon={<Hash size={18} />} onSelect={handleChannelSelect} />
                  <ChannelTab channel="message" activeChannel={activeChannel} icon={<MessageCircle size={18} />} onSelect={handleChannelSelect} />
                </div>
                <div
                  className="draft-editor-panel"
                  role="tabpanel"
                  aria-label={`${channelLabels[activeChannel]} 초안 편집`}
                >
                  <label htmlFor={`draft-editor-${activeChannel}`}>
                    <strong>초안 내용</strong>
                    <span>{channelDrafts[activeChannel].length}자 · 바로 수정 가능</span>
                  </label>
                  <textarea
                    id={`draft-editor-${activeChannel}`}
                    className="draft-editor"
                    value={channelDrafts[activeChannel]}
                    onChange={(event) => handleDraftChange(event.target.value)}
                    spellCheck
                  />
                  <p>수정한 내용이 복사할 초안에 바로 반영됩니다.</p>
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
                        onClick={() => handleImageTemplateSelect("promotional")}
                      >
                        <ImageIcon size={18} />
                        <span><strong>홍보용</strong><small>눈에 띄는 모집·혜택 중심</small></span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={imageTemplate === "informational"}
                        className={imageTemplate === "informational" ? "is-active" : ""}
                        onClick={() => handleImageTemplateSelect("informational")}
                      >
                        <FileText size={18} />
                        <span><strong>안내용</strong><small>정보를 빠르게 확인하는 구성</small></span>
                      </button>
                    </div>
                    <div className="image-workspace">
                      <ImageDraftPreview draft={imageDraft} />
                      <div className="image-guide">
                        <strong>1080 × 1350 PNG</strong>
                        <span>SNS 피드와 모바일 안내에 적합한 4:5 비율입니다.</span>
                        <span>현재 {channelLabels[activeChannel]} 초안의 핵심 정보가 반영됩니다.</span>
                        <span>별도 확인 없이 바로 저장할 수 있습니다.</span>
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
              <p>메일 내용을 입력하고 정리하기를 누르면 핵심 정보와 홈페이지, SNS, 메시지용 초안이 표시됩니다.</p>
            </div>
          )}
        </div>
      </section>

      <section className="feedback-section" id="feedback" aria-label="부서 피드백 확인 항목">
        <div>
          <p className="panel-kicker">부서 피드백에서 확인할 내용</p>
          <h2>가정과 질문</h2>
        </div>
        <div className="feedback-grid">
          <div>
            <h3>가정</h3>
            <ul>
              <li>담당자는 공유 메일을 읽고 홈페이지, 문자, 이메일, SNS용 공지를 수동 작성합니다.</li>
              <li>첫 프로토타입은 저장하지 않고 화면 내 상태만 관리합니다.</li>
              <li>채널별 초안은 필요한 내용을 직접 수정한 뒤 바로 복사해 사용합니다.</li>
            </ul>
          </div>
          <div>
            <h3>질문</h3>
            <ul>
              <li>공유 메일을 공지로 옮길 때 가장 자주 누락되는 정보는 무엇인가요?</li>
              <li>이 정도의 공지 초안이면 실제 업무에서 검토 후 사용할 수 있나요?</li>
              <li>이 도구를 사용하지 않는다면 가장 큰 이유는 무엇일까요?</li>
            </ul>
          </div>
        </div>
      </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className={value ? "info-card" : "info-card is-missing"}>
      <span>{label}</span>
      <strong>{value || "담당자 확인 필요"}</strong>
    </div>
  );
}

function ChannelTab({ channel, activeChannel, icon, onSelect }: { channel: Channel; activeChannel: Channel; icon: ReactNode; onSelect: (channel: Channel) => void }) {
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

export default App;
