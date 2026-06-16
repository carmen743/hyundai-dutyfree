import { useState, useEffect } from 'react';
import { callAPI } from './api.js';
import { renderResultHtml } from './renderResult.js';

const EMPTY_FORM = { name: '', birth: '', destination: '', gender: '' };

export default function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [view, setView] = useState('form'); // 'form' | 'result'
  const [loading, setLoading] = useState(false);
  const [imageSrc, setImageSrc] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [resultHtml, setResultHtml] = useState(null);
  const [globalError, setGlobalError] = useState(false);
  const [formError, setFormError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState('');

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // 로딩 중 경과 시간 카운터 (대기 체감 완화)
  useEffect(() => {
    if (!loading) return undefined;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  async function handleSubmit() {
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
    setImageSrc(null);
    setImageError(false);
    setResultHtml(null);
    setGlobalError(false);

    const fields = { name, birth, destination, gender };

    try {
      // 이미지/텍스트를 독립적으로 처리 — 한쪽이 실패해도 다른 쪽 결과는 살린다.
      const [imageResult, textResult] = await Promise.allSettled([
        callAPI('image', fields),
        callAPI('text', fields),
      ]);

      const imageOk = imageResult.status === 'fulfilled' && imageResult.value?.image;
      if (imageOk) {
        setImageSrc(`data:image/png;base64,${imageResult.value.image}`);
      } else {
        if (imageResult.status === 'rejected') console.error('이미지 생성 실패:', imageResult.reason);
        setImageError(true);
      }

      if (textResult.status === 'fulfilled' && textResult.value?.text) {
        setResultHtml(renderResultHtml(textResult.value.text));
      } else {
        if (textResult.status === 'rejected') console.error('사주 생성 실패:', textResult.reason);
        if (!imageOk) setGlobalError(true);
      }
    } catch (e) {
      console.error(e);
      setGlobalError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setView('form');
    setImageSrc(null);
    setImageError(false);
    setResultHtml(null);
    setGlobalError(false);
    setToast('');
  }

  async function handleShare() {
    const shareData = {
      title: '현대면세점집 🔮',
      text: '이번 여행에서 만날 운명의 인연을 확인해보세요!',
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setToast('링크가 복사되었어요!');
        setTimeout(() => setToast(''), 2500);
      }
    } catch {
      /* 사용자 취소 등은 무시 */
    }
  }

  function handleSave() {
    if (!imageSrc) return;
    const a = document.createElement('a');
    a.href = imageSrc;
    a.download = '현대면세점집-인연.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="app">
      <div className="header">
        <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">🔮</div>
        <h1>현대면세점집</h1>
        <p>이번 여행에서 만나게 될 인연을 보여드릴게요</p>
      </div>

      {view === 'form' ? (
        <div>
          <div className="form-group">
            <label htmlFor="f-name">이름 (별명)</label>
            <input id="f-name" type="text" value={form.name} onChange={update('name')} placeholder="예) 김현대" autoComplete="off" />
          </div>
          <div className="form-group">
            <label htmlFor="f-birth">생년월일</label>
            <input id="f-birth" type="text" inputMode="numeric" value={form.birth} onChange={update('birth')} placeholder="예) 00.00.00" maxLength={10} />
          </div>
          <div className="form-group">
            <label htmlFor="f-dest">여행지</label>
            <input id="f-dest" type="text" value={form.destination} onChange={update('destination')} placeholder="예) 도쿄, 파리, 발리" />
          </div>
          <div className="form-group">
            <label htmlFor="f-gender">원하는 인연 성별</label>
            <select id="f-gender" value={form.gender} onChange={update('gender')}>
              <option value="">선택해주세요</option>
              <option value="남성">남성</option>
              <option value="여성">여성</option>
            </select>
          </div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="submit-btn" onClick={handleSubmit} disabled={loading}>
            인연 보러가기 ✨
          </button>
        </div>
      ) : (
        <div className="result">
          {loading ? (
            <div className="img-placeholder skeleton" role="status" aria-live="polite" aria-busy="true">
              <div className="loading-inner">
                <div className="spinner" aria-hidden="true" />
                <div>🔮 인연의 얼굴을 그리는 중... {elapsed}초</div>
                <div className="loading-sub">최대 30초 정도 걸려요</div>
              </div>
            </div>
          ) : imageSrc ? (
            <img className="result-image" src={imageSrc} alt={`${form.destination}에서 만날 인연의 모습`} />
          ) : imageError ? (
            <div className="img-placeholder">인연의 얼굴을 불러오지 못했어요 😢</div>
          ) : null}

          {loading && (
            <div className="text-placeholder" role="status" aria-live="polite">사주를 읽는 중이에요...</div>
          )}

          {!loading && globalError && (
            <div className="result-card">
              <div className="result-text">
                <p style={{ color: '#595959' }}>오류가 발생했어요. 다시 시도해주세요.</p>
              </div>
            </div>
          )}

          {!loading && resultHtml && (
            <div className="result-card">
              <div className="result-text" dangerouslySetInnerHTML={{ __html: resultHtml }} />
            </div>
          )}

          {!loading && (imageSrc || resultHtml) && (
            <div className="action-row">
              <button className="action-btn" onClick={handleShare}>공유하기</button>
              {imageSrc && (
                <button className="action-btn" onClick={handleSave}>이미지 저장</button>
              )}
            </div>
          )}
          {toast && <div className="toast" role="status">{toast}</div>}

          {!loading && (
            <button className="reset-btn" onClick={handleReset}>다시 보기</button>
          )}
        </div>
      )}
    </div>
  );
}
