import { Component } from 'react';

// 렌더 중 예외가 나도 전체 백지가 되지 않도록 막는 방어선.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app">
          <div className="header">
            <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">🔮</div>
            <h1>현대면세점 여행자 인연 미리보기</h1>
          </div>
          <div className="text-placeholder">문제가 발생했어요. 페이지를 새로고침 해주세요.</div>
          <button className="reset-btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
