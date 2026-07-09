import { useMemo } from 'react';

const DEFAULT_EVENT_ID = '0007638';
const WIDGET_HEIGHT = 844;

function getPreviewEventId() {
  const value = new URLSearchParams(window.location.search).get('evntId')?.trim() || DEFAULT_EVENT_ID;
  return /^[0-9A-Za-z_-]{1,20}$/.test(value) ? value : DEFAULT_EVENT_ID;
}

export default function PreviewShell() {
  const eventId = getPreviewEventId();
  const widgetSrc = useMemo(() => `/widget?evntId=${encodeURIComponent(eventId)}`, [eventId]);

  return (
    <div className="hdf-preview-page">
      <header className="hdf-preview-header">
        <div className="hdf-preview-topbar">
          <button type="button">언어설정 한국어</button>
          <span>$1 = 1526.60 원</span>
        </div>
        <div className="hdf-preview-account-row">
          <span>로그인</span>
          <span>회원가입</span>
          <span>고객센터</span>
          <span>지점안내</span>
          <span>주문가능시간</span>
        </div>
        <div className="hdf-preview-brand-row">
          <button type="button" aria-label="Navigation Drawer">☰</button>
          <strong>HYUNDAI<br />DUTY FREE</strong>
          <button type="button" aria-label="검색">⌕</button>
        </div>
        <div className="hdf-preview-search">몽클레르 특정 향수 구매시 향수 30ml 증정</div>
        <nav className="hdf-preview-nav" aria-label="주요 메뉴">
          <span>세일</span>
          <span>베스트</span>
          <span>혜택</span>
          <span>브랜드 행사</span>
        </nav>
      </header>

      <main className="hdf-preview-main">
        <section className="hdf-preview-category" aria-label="카테고리">
          <h2>카테고리</h2>
          <div className="hdf-preview-tabs">
            <span>스킨케어</span>
            <span>메이크업</span>
            <span>향수/헤어/바디</span>
            <span>가방/지갑</span>
            <span>패션/잡화</span>
            <span>스포츠/레저</span>
            <span>전자/리빙</span>
            <span>주류</span>
          </div>
        </section>

        <article className="hdf-preview-event">
          <iframe
            title="여행자 인연 미리보기"
            src={widgetSrc}
            style={{ border: 0, width: '100%', height: `${WIDGET_HEIGHT}px`, margin: '0 auto', display: 'block', overflow: 'hidden' }}
            allow="web-share; clipboard-write"
          />
        </article>
      </main>

      <footer className="hdf-preview-footer">
        <div className="hdf-preview-footer-links">
          <span>지점 안내</span>
          <span>입점/제휴</span>
          <strong>개인정보처리방침</strong>
          <span>이메일무단수집거부</span>
        </div>
        <strong className="hdf-preview-footer-logo">HYUNDAI DUTY FREE</strong>
        <p>㈜현대디에프 · 서울특별시 강남구 영동대로82길 19</p>
        <p>대표번호 : 1811-6688 · 대표메일 : hddfs_official@hddfs.com</p>
        <p className="hdf-preview-copy">COPYRIGHT © HYUNDAI DF Co,. Ltd. ALL RIGHTS RESERVED.</p>
      </footer>
    </div>
  );
}
