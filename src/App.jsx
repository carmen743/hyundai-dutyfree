import { useState, useEffect, useRef } from 'react';
import { toBlob } from 'html-to-image';
import { callAPI } from './api.js';

const EMPTY_FORM = { name: '', birth: '', destination: '', gender: '' };
const GENDER_OPTIONS = ['남성', '여성'];
const APP_TITLE = '여행지 인연 미리보기';
const FULL_TITLE = '현대면세점 여행자 인연 미리보기';
const DUTYFREE_LINK = 'https://www.hddfs.com/';
const CATEGORY_LINKS = {
  향수: 'https://www.hddfs.com/shop/dm/best/monthly.do?goosCtgId=0003',
  '패션/잡화': 'https://www.hddfs.com/shop/dm/best/monthly.do?goosCtgId=0007',
  '스포츠/레저': 'https://www.hddfs.com/shop/dm/best/monthly.do?goosCtgId=0013',
  '전자/리빙': 'https://www.hddfs.com/shop/dm/best/monthly.do?goosCtgId=0008',
  주류: 'https://www.hddfs.com/shop/dm/best/monthly.do?goosCtgId=0014',
};
const LOADING_MESSAGES = [
  '눈코입을 만드는 중...',
  '여행지 버프 추가 중...',
  '눈빛 조율 중...',
  '인연에게 다가가는 중...',
];

function LogoMark({ small = false }) {
  return <img className={small ? 'logo logo-small' : 'logo'} src="/logo.png" alt="현대면세점" />;
}

function ImageBrandLogo() {
  return <img className="image-brand-logo" src="/hyundai-dutyfree-wordmark-white.png" alt="HYUNDAI DUTY FREE" />;
}

// 캡처 직전에 노드 내부 이미지 디코딩을 보장한다(공유 버튼을 즉시 눌렀을 때의 미디코드 방지).
async function ensureImagesDecoded(node) {
  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(images.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
}

// iOS Safari는 foreignObject 내부 이미지를 첫 rasterize 때 비워두는 경우가 있어,
// 동일 옵션으로 두 번 워밍업 렌더한 뒤 마지막 결과를 사용한다.
async function captureShareBlob(node, options) {
  await toBlob(node, options);
  await toBlob(node, options);
  return toBlob(node, options);
}

function formatBirth(value) {
  const digits = value.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

function normalizeGeneratedResult(result, form) {
  const story = Array.isArray(result?.story) ? result.story.filter(Boolean).slice(0, 7) : [];
  const personality = Array.isArray(result?.personality) ? result.personality.filter(Boolean).slice(0, 3) : [];
  return {
    tagline: result?.tagline || `${form.name}님의 운명이 ${form.destination}에서 기다리고 있습니다.`,
    name: result?.name || '운명의 인연',
    nationality: result?.nationality || `${form.destination}의 여행자`,
    job: result?.job || '여행자',
    personality,
    style: result?.style || '감성형',
    quote: result?.quote || '오늘은 그냥 지나치지 말아요.',
    story,
    category: result?.category || '향수',
    imagePrompt: result?.imagePrompt || '',
    isComic: Boolean(result?.isComic),
  };
}

function GenderDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedText = value || '선택해주세요';

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(e) {
      if (!dropdownRef.current?.contains(e.target)) setOpen(false);
    }

    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div className={`custom-select${open ? ' is-open' : ''}`} ref={dropdownRef}>
      <button
        id="f-gender"
        ref={triggerRef}
        className="custom-select-trigger"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="gender-listbox"
        aria-labelledby="f-gender-label f-gender"
        onClick={() => setOpen((next) => !next)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="custom-select-value" data-placeholder={!value}>{selectedText}</span>
      </button>

      {open && (
        <div className="custom-select-menu" id="gender-listbox" role="listbox" aria-labelledby="f-gender-label">
          {GENDER_OPTIONS.map((option) => (
            <button
              key={option}
              className={`custom-select-option${value === option ? ' is-selected' : ''}`}
              type="button"
              role="option"
              aria-selected={value === option}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [view, setView] = useState('form'); // 'form' | 'result'
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [imageSrc, setImageSrc] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [resultData, setResultData] = useState(null);
  const [globalError, setGlobalError] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const resultCaptureRef = useRef(null);

  const isBusy = loading || imageLoading;
  const loadingMessage = LOADING_MESSAGES[loadingMessageIndex % LOADING_MESSAGES.length];

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const updateBirth = (e) => setForm((f) => ({ ...f, birth: formatBirth(e.target.value) }));
  const updateGender = (gender) => setForm((f) => ({ ...f, gender }));

  useEffect(() => {
    if (!isBusy) return undefined;
    setLoadingMessageIndex(0);
    const timer = setInterval(() => {
      setLoadingMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(timer);
  }, [isBusy]);

  function handleBirthKeyDown(e) {
    if (e.key !== 'Backspace') return;
    const input = e.currentTarget;
    if (input.selectionStart !== input.selectionEnd) return;
    const caret = input.selectionStart;
    if (caret <= 0 || input.value[caret - 1] !== '.') return;

    e.preventDefault();
    const beforeDotDigits = input.value.slice(0, caret - 1).replace(/\D/g, '');
    const afterDotDigits = input.value.slice(caret).replace(/\D/g, '');
    const nextBirth = formatBirth(`${beforeDotDigits.slice(0, -1)}${afterDotDigits}`);
    setForm((f) => ({ ...f, birth: nextBirth }));
    requestAnimationFrame(() => {
      const nextCaret = Math.max(0, caret - 2);
      input.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const name = form.name.trim();
    const birth = form.birth.trim();
    const destination = form.destination.trim();
    const gender = form.gender;

    if (!name || !birth || !destination || !gender) {
      setFormError('모든 항목을 입력해주세요.');
      return;
    }

    setFormError('');
    setView('result');
    setLoading(true);
    setImageLoading(false);
    setImageSrc(null);
    setImageError(false);
    setResultData(null);
    setGlobalError(false);
    setToast('');

    const resultSeed = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const fields = { name, birth, destination, gender, resultSeed };

    try {
      const textResult = await callAPI('text', fields);
      const nextResult = normalizeGeneratedResult(textResult.result, { name, destination });
      setResultData(nextResult);
      setLoading(false);

      if (!nextResult.imagePrompt) {
        setImageError(true);
        return;
      }

      setImageLoading(true);
      try {
        const imageResult = await callAPI('image', { ...fields, imagePrompt: nextResult.imagePrompt });
        if (imageResult?.image) {
          setImageSrc(`data:image/png;base64,${imageResult.image}`);
        } else {
          setImageError(true);
        }
      } catch (imageErr) {
        console.error('이미지 생성 실패:', imageErr);
        setImageError(true);
      } finally {
        setImageLoading(false);
      }
    } catch (err) {
      console.error('결과 생성 실패:', err);
      setLoading(false);
      setImageLoading(false);
      setGlobalError(true);
    }
  }

  function handleReset() {
    setView('form');
    setImageSrc(null);
    setImageError(false);
    setResultData(null);
    setGlobalError(false);
    setToast('');
  }

  async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  async function copyText(text, message) {
    await writeClipboardText(text);
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  }

  async function copyShareUrl(url, message = '링크가 복사되었어요!') {
    await copyText(url, message);
  }

  async function shareNativeOrCopy(shareData, fallbackMessage) {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await copyShareUrl(shareData.url, fallbackMessage);
    }
  }

  async function handleResultShare() {
    const shareUrl = window.location.href;
    const shareData = {
      title: `${form.name || '나'}님의 여행지 인연`,
      text: resultData?.name
        ? `${form.destination}에서 만날 ${resultData.name}와의 인연을 확인해보세요!`
        : '이번 여행에서 만날 인연을 미리 확인해보세요!',
      url: shareUrl,
    };

    try {
      let imageFile = null;
      const captureNode = resultCaptureRef.current;
      if (captureNode) {
        await ensureImagesDecoded(captureNode);
        const captureRect = captureNode.getBoundingClientRect();
        const captureWidth = Math.ceil(captureRect.width);
        const captureHeight = Math.ceil(captureNode.scrollHeight || captureRect.height);
        const blob = await captureShareBlob(captureNode, {
          backgroundColor: '#ffffff',
          cacheBust: true,
          width: captureWidth,
          height: captureHeight,
          style: {
            // 라이브 뷰의 풀블리드용 margin: 0 -18px 를 캡처 시 0 으로 덮어 우측 여백/좌측 잘림 방지
            width: `${captureWidth}px`,
            height: `${captureHeight}px`,
            margin: '0',
            overflow: 'visible',
          },
          pixelRatio: Math.min(2, window.devicePixelRatio || 1),
          filter: (node) => node.dataset?.shareExclude !== 'true',
        });
        if (blob) imageFile = new File([blob], 'hyundai-dutyfree-result.png', { type: 'image/png' });
      }

      if (imageFile && navigator.canShare?.({ files: [imageFile] })) {
        await navigator.share({ ...shareData, files: [imageFile] });
        return;
      }

      await shareNativeOrCopy(shareData, '결과 링크가 복사되었어요!');
    } catch {
      /* 사용자 취소 등은 무시 */
    }
  }

  async function handleTestShare() {
    const shareText = `${FULL_TITLE}\n${window.location.href}`;
    try {
      await copyText(shareText, '테스트 공유 문구와 링크가 복사되었어요!');
    } catch {
      /* 클립보드 권한 거부 등은 무시 */
    }
  }

  const itemLink = CATEGORY_LINKS[resultData?.category] || CATEGORY_LINKS.향수;

  return (
    <main className="app">
      {view === 'form' && (
        <section className="intro-card" aria-labelledby="main-title">
          <LogoMark />
          <h1 id="main-title">{APP_TITLE}</h1>
          <p className="subtitle subtitle-strong">현대면세점 ✨[여]행 [연]애 [시]뮬레이션 출시✨</p>
          <p className="subtitle">여행지에서 만나게 될 인연과<br />행운의 아이템을 알려드려요 🔮</p>

          <form className="input-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="f-name">이름 (별명)</label>
              <input id="f-name" type="text" value={form.name} onChange={update('name')} placeholder="예) 김현대" autoComplete="off" />
            </div>
            <div className="form-group">
              <label htmlFor="f-birth">생년월일</label>
              <input id="f-birth" type="text" inputMode="numeric" value={form.birth} onChange={updateBirth} onKeyDown={handleBirthKeyDown} placeholder="예) 97.05.14" maxLength={8} />
            </div>
            <div className="form-group">
              <label htmlFor="f-dest">여행지</label>
              <input id="f-dest" type="text" value={form.destination} onChange={update('destination')} placeholder="예) 도쿄, 파리, 발리" />
            </div>
            <div className="form-group">
              <label id="f-gender-label" htmlFor="f-gender">원하는 인연 성별</label>
              <GenderDropdown value={form.gender} onChange={updateGender} />
            </div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="submit-btn" type="submit" disabled={loading}>
              인연 보러가기 ✨
            </button>
          </form>
        </section>
      )}

      {view === 'result' && loading && !resultData && (
        <section className="loading-screen" role="status" aria-live="polite" aria-busy="true">
          <LogoMark />
          <h1>{APP_TITLE}</h1>
          <p key={loadingMessage} className="loading-message">{loadingMessage}</p>
        </section>
      )}

      {view === 'result' && globalError && (
        <section className="loading-screen error-screen" role="alert">
          <LogoMark />
          <h1>{APP_TITLE}</h1>
          <p>오류가 발생했어요. 다시 시도해주세요.</p>
          <button className="submit-btn" type="button" onClick={handleReset}>다시 입력하기</button>
        </section>
      )}

      {view === 'result' && resultData && (
        <section className="result-page">
          <div className="result-share-sheet" ref={resultCaptureRef}>
            <h1 className="result-heading"><span>{form.name || 'OO'}님의</span> 여행지 인연</h1>

            <div className="image-stage">
              {imageSrc && (
                <button className="image-close-button" type="button" onClick={handleReset} aria-label="이전 화면으로 돌아가기" data-share-exclude="true">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
              {imageSrc ? (
                <img className="result-image" src={imageSrc} alt={`${form.destination}에서 만날 인연의 모습`} />
              ) : (
                <div className="image-placeholder" role={imageLoading ? 'status' : undefined} aria-live={imageLoading ? 'polite' : undefined} aria-busy={imageLoading || undefined}>
                  <LogoMark small />
                  <p key={loadingMessage} className="loading-message image-message">
                    {imageLoading ? loadingMessage : '이미지 생성이 지연되어 텍스트 결과 먼저 보여드려요.'}
                  </p>
                </div>
              )}
              {imageSrc && <div className="image-brand-logo-wrap"><ImageBrandLogo /></div>}
            </div>

            {imageError && <p className="image-note">이미지 없이 결과를 먼저 보여드릴게요.</p>}

            <article className="profile-card">
              <div className="profile-topline">{resultData.nationality} · {resultData.job}</div>
              <h2>{resultData.name}</h2>
              <div className="tag-row" aria-label="성격 태그">
                {resultData.personality.map((tag) => <span key={tag} className="tag">{tag}</span>)}
                <span className="tag tag-style">{resultData.style}</span>
              </div>
              <blockquote>{resultData.quote}</blockquote>
            </article>

            <article className="story-card">
              {resultData.story.map((paragraph, index) => (
                <p key={`${paragraph}-${index}`} className={index === 2 ? 'story-highlight' : undefined}>{paragraph}</p>
              ))}
            </article>
          </div>

          <div className="bottom-actions">
            <a className="primary-action" href={itemLink} target="_blank" rel="noopener noreferrer nofollow">
              🛍 {resultData.name}의 취향 아이템 보기
            </a>
            <a className="secondary-action" href={DUTYFREE_LINK} target="_blank" rel="noopener noreferrer nofollow">
              🏪 현대면세점 보러가기
            </a>
            <button className="share-action" type="button" onClick={handleResultShare}>
              결과지 공유하기
            </button>
            <button className="share-action" type="button" onClick={handleTestShare}>
              테스트 공유하기
            </button>
          </div>
          {toast && <div className="toast" role="status">{toast}</div>}
          <button className="reset-link" type="button" onClick={handleReset}>다시 입력하기</button>
        </section>
      )}
    </main>
  );
}
