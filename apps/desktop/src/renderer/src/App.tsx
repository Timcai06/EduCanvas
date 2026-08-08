import { useEffect, useRef, useState } from 'react';
import { useAssistantTurn } from './use-assistant-turn';

export default function App(): React.JSX.Element {
  const { bubbles, busy, send, cancel } = useAssistantTurn();
  const [input, setInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 主进程事件：首次隐藏到托盘的提示（经 preload 桥转发）
  useEffect(() => {
    return window.desktopAssistant.onToast((message) => setToast(message));
  }, []);

  useEffect(() => {
    if (listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [bubbles]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = (): void => {
    if (!input.trim() || busy) return;
    send(input);
    setInput('');
  };

  return (
    <main className="app">
      <header className="header">
        <span className="dot" />
        <span className="title">EduCanvas 助手</span>
        <span className="hint">笔记本管理</span>
      </header>

      {toast && (
        <div
          className="toast"
          onClick={() => setToast(null)}
          role="button"
          aria-label="关闭提示"
        >
          {toast}
        </div>
      )}

      <div className="bubbles" ref={listRef}>
        {bubbles.length === 0 && <p className="empty">输入指令管理笔记本</p>}
        {bubbles.map((b) => (
          <div key={b.id} className={`bubble ${b.role} ${b.status}`}>
            {b.role === 'assistant' && <span className="dot small" />}
            <div className="text">
              {b.text || (b.status === 'pending' ? '...' : '')}
            </div>
          </div>
        ))}
      </div>

      <footer className="input-row">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入指令..."
          rows={1}
          disabled={busy}
        />
        {busy ? (
          <button className="send" onClick={cancel} aria-label="取消">
            ✕
          </button>
        ) : (
          <button
            className="send"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="发送"
          >
            发送
          </button>
        )}
      </footer>
    </main>
  );
}
