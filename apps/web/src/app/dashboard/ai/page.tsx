'use client';

import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

async function streamRequest(
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const res = await fetch('/api/v1/ai/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401) {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

function InsightsPanel() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function load() {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) { setError('No company selected.'); return; }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setText('');
    setError(null);
    setLoading(true);

    try {
      await streamRequest(
        { company_id: companyId, mode: 'insights' },
        (chunk) => setText((prev) => prev + chunk),
        abortRef.current.signal,
      );
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Business Health Analysis</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Auto-generated from your live financial and operations data</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? 'Analyzing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : !text && loading ? (
        <div className="space-y-2">
          {[80, 60, 72, 55, 68].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 text-xs leading-relaxed whitespace-pre-wrap">
          {text}
          {loading && <span className="inline-block h-3 w-0.5 bg-slate-400 animate-pulse ml-0.5" />}
        </div>
      )}
    </div>
  );
}

function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;

    const userMsg: Message = { role: 'user', content: question };
    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const apiMessages = history.map((m) => ({ role: m.role, content: m.content }));

    try {
      await streamRequest(
        { company_id: companyId, mode: 'chat', messages: apiMessages },
        (chunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + chunk };
            return updated;
          });
        },
        abortRef.current.signal,
      );
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${(e as Error).message}` };
          return updated;
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const SUGGESTED = [
    'Which customers have the largest overdue balances?',
    'How is my cash position — AR vs AP?',
    'What is the mortality rate trend across my grow cycles?',
    'Are there any urgent collection or payment actions I should take?',
  ];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col" style={{ minHeight: 420 }}>
      <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ask a Question</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Ask anything about your finances or operations</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Suggested questions:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                  className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-brand-600 text-white dark:bg-brand-500'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                }`}
              >
                {msg.content}
                {msg.role === 'assistant' && loading && i === messages.length - 1 && msg.content === '' && (
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
                {msg.role === 'assistant' && loading && i === messages.length - 1 && msg.content !== '' && (
                  <span className="inline-block h-3 w-0.5 bg-slate-400 animate-pulse ml-0.5" />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your finances or operations… (Enter to send)"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="shrink-0 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 px-4 py-2 text-xs font-medium text-white"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function AIAnalysisPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI Analysis</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          AI-powered insights from your live ERP data — financial health, collections, and poultry operations.
        </p>
      </div>

      <InsightsPanel />
      <ChatPanel />
    </div>
  );
}
