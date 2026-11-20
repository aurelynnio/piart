import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Đã xảy ra lỗi không xác định trong giao diện.'
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[AI Pixel Studio] Renderer ErrorBoundary caught:', error, info)
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div
        role="alert"
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-app, #181816)',
          color: 'var(--text-primary, #F0EDE5)'
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: '100%',
            background: 'var(--bg-panel, #20201D)',
            border: '1px solid rgba(229, 107, 111, 0.45)',
            borderRadius: 6,
            padding: 20,
            boxShadow: 'var(--shadow-modal)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={18} color="var(--status-error, #E56B6F)" />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              Giao diện gặp lỗi ngoài dự kiến
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #B1ADA2)', lineHeight: 1.55 }}>
            Dữ liệu dự án trong SQLite vẫn được bảo toàn. Bạn có thể tải lại giao diện để tiếp tục làm việc.
          </p>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 4,
              background: 'var(--bg-canvas-well, #121311)',
              border: '1px solid var(--border-divider, #35342E)',
              fontSize: 12,
              color: '#F08F92',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {this.state.message}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              className="primary"
              onClick={() => window.location.reload()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={14} />
              Tải lại giao diện
            </button>
          </div>
        </div>
      </div>
    )
  }
}
