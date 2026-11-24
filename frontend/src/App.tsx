import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  RotateCcw,
  Sparkles,
  Terminal,
  Cpu,
  Layers,
  Copy,
  Check,
  AlertTriangle,
  Server,
  Settings2,
  HelpCircle,
  Zap
} from 'lucide-react';

interface AssistantMetadata {
  resolution_source: 'LIVE_INFERENCE' | 'LLM_CACHE';
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  key_id?: string | null;
  fallback_attempts: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  metadata?: AssistantMetadata;
  timestamp?: string;
}

interface HealthStatus {
  status: string;
  keys_configured: number;
  cache_enabled: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export default function App() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [showSystemPrompt, setShowSystemPrompt] = useState<boolean>(false);
  const [simulateFailure, setSimulateFailure] = useState<string>('none');
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [copiedSession, setCopiedSession] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize fresh session ID on page load
  useEffect(() => {
    startNewSession();
    checkHealth();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const startNewSession = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const newId = `s-${randomSuffix}`;
    setSessionId(newId);
    setMessages([]);
    setInputMessage('');
  };

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.warn('Backend health check pending or unreachable:', e);
    }
  };

  const copySessionId = () => {
    navigator.clipboard.writeText(sessionId);
    setCopiedSession(true);
    setTimeout(() => setCopiedSession(false), 2000);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const rawMessage = textToSend !== undefined ? textToSend : inputMessage;
    const trimmedMessage = rawMessage.trim();

    if (!trimmedMessage || isLoading) return;

    // Requirement: Clear input immediately after sending
    setInputMessage('');

    // Add user message to UI
    const userMsgId = `user-${Date.now()}`;
    const newMessages: Message[] = [
      ...messages,
      {
        id: userMsgId,
        role: 'user',
        content: trimmedMessage,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (simulateFailure !== 'none') {
        headers['X-Simulate-Failure'] = simulateFailure;
      }

      const payload: {
        session_id: string;
        message: string;
        system_prompt?: string;
      } = {
        session_id: sessionId,
        message: trimmedMessage
      };

      if (systemPrompt.trim()) {
        payload.system_prompt = systemPrompt.trim();
      }

      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        // Human-readable error banner
        const errorDetail = typeof data.detail === 'string'
          ? data.detail
          : JSON.stringify(data.detail);

        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'error',
            content: `Error (${res.status}): ${errorDetail}`
          }
        ]);
      } else {
        // Success: append assistant response with exact contract fields
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: data.reply,
            metadata: data.metadata,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'error',
          content: `Network error: ${err.message || 'Failed to connect to backend server'}`
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#000000', color: '#f4f4f5' }}>
      {/* Top Navigation Bar */}
      <header
        style={{
          borderBottom: '1px solid #1c1c20',
          backgroundColor: 'rgba(10, 10, 12, 0.85)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        {/* Left: Logo & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              border: '1.5px solid #27272a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#121214'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e4e4e7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="m4.93 4.93 4.24 4.24" />
              <path d="m14.83 9.17 4.24-4.24" />
              <path d="m14.83 14.83 4.24 4.24" />
              <path d="m9.17 14.83-4.24 4.24" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em', color: '#ffffff' }}>Lyftr AI</span>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(37, 99, 235, 0.12)',
                  color: '#60a5fa',
                  border: '1px solid rgba(37, 99, 235, 0.3)'
                }}
              >
                Gateway v1.0
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#71717a', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={11} color="#a855f7" />
              <span>Multi-Key Failover & Intelligent Cache</span>
            </div>
          </div>
        </div>

        {/* Center/Right Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Health indicator */}
          <div
            title={health ? `Configured Keys: ${health.keys_configured}` : 'Checking health...'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '24px',
              backgroundColor: '#111114',
              border: '1px solid #202024',
              fontSize: '0.75rem',
              color: '#a1a1aa'
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: health?.status === 'ok' ? '#10b981' : '#f59e0b',
                boxShadow: health?.status === 'ok' ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none'
              }}
            />
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {health ? `${health.keys_configured} Keys Active` : 'Backend Sync'}
            </span>
          </div>

          {/* Session ID Pill */}
          <button
            onClick={copySessionId}
            title="Click to copy Session ID"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '24px',
              backgroundColor: '#111114',
              border: '1px solid #202024',
              color: '#d4d4d8',
              fontSize: '0.75rem',
              fontFamily: 'JetBrains Mono, monospace',
              cursor: 'pointer'
            }}
            className="dark-blue-hover"
          >
            <span>{sessionId}</span>
            {copiedSession ? <Check size={12} color="#10b981" /> : <Copy size={12} color="#71717a" />}
          </button>

          {/* System Prompt Toggle Button */}
          <button
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
            title="Configure System Prompt"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '24px',
              backgroundColor: showSystemPrompt ? '#1e293b' : '#111114',
              border: showSystemPrompt ? '1px solid #3b82f6' : '1px solid #202024',
              color: showSystemPrompt ? '#60a5fa' : '#a1a1aa',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: 'pointer'
            }}
            className="dark-blue-hover"
          >
            <Settings2 size={13} />
            <span>System Prompt</span>
          </button>

          {/* Failover Test Hook Pill */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSimulateModal(!showSimulateModal)}
              title="Test Key Failover Simulation"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '24px',
                backgroundColor: simulateFailure !== 'none' ? 'rgba(239, 68, 68, 0.15)' : '#111114',
                border: simulateFailure !== 'none' ? '1px solid #ef4444' : '1px solid #202024',
                color: simulateFailure !== 'none' ? '#f87171' : '#a1a1aa',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer'
              }}
              className="dark-blue-hover"
            >
              <Zap size={13} color={simulateFailure !== 'none' ? '#ef4444' : '#eab308'} />
              <span>
                {simulateFailure === 'none' ? 'Failover Hook' : `Sim: ${simulateFailure}`}
              </span>
            </button>

            {/* Simulation Dropdown Menu */}
            {showSimulateModal && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '115%',
                  width: '280px',
                  backgroundColor: '#121216',
                  border: '1px solid #27272e',
                  borderRadius: '24px',
                  padding: '12px',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.8)',
                  zIndex: 50
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f4f4f5', marginBottom: '4px' }}>
                  X-Simulate-Failure Hook
                </div>
                <div style={{ fontSize: '0.7rem', color: '#71717a', marginBottom: '10px' }}>
                  Inject provider errors on demand to verify instant key failover without burning real quota.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    { label: 'None (Live calls with cache)', val: 'none' },
                    { label: 'key_1=429 (Rate limit key_1 -> key_2)', val: 'key_1=429' },
                    { label: 'key_1=500 (Server error key_1 -> key_2)', val: 'key_1=500' },
                    { label: '*=429 (Total Outage -> HTTP 503)', val: '*=429' }
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      onClick={() => {
                        setSimulateFailure(opt.val);
                        setShowSimulateModal(false);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '7px 10px',
                        borderRadius: '24px',
                        fontSize: '0.73rem',
                        cursor: 'pointer',
                        backgroundColor: simulateFailure === opt.val ? '#1e293b' : 'transparent',
                        color: simulateFailure === opt.val ? '#60a5fa' : '#d4d4d8',
                        border: simulateFailure === opt.val ? '1px solid #3b82f6' : '1px solid transparent'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* New conversation button */}
          <button
            onClick={startNewSession}
            title="Start New Conversation"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '24px',
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              color: '#e4e4e7',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: 'pointer'
            }}
            className="dark-blue-hover"
          >
            <RotateCcw size={13} />
            <span>New conversation</span>
          </button>
        </div>
      </header>

      {/* System Prompt Collapsible Drawer */}
      {showSystemPrompt && (
        <div
          style={{
            backgroundColor: '#0d0d10',
            borderBottom: '1px solid #1f1f24',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
          className="animate-fade-in"
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a1a1aa', whiteSpace: 'nowrap' }}>
            System Prompt:
          </span>
          <input
            data-testid="system-prompt-input"
            type="text"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="e.g. You are Lyftr AI, a concise software engineering mentor."
            style={{
              flex: 1,
              backgroundColor: '#141418',
              border: '1px solid #27272e',
              borderRadius: '8px',
              padding: '8px 12px',
              color: '#f4f4f5',
              fontSize: '0.82rem',
              outline: 'none'
            }}
          />
          <button
            onClick={() => setSystemPrompt('')}
            style={{
              fontSize: '0.7rem',
              color: '#71717a',
              background: 'none',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Reset
          </button>
        </div>
      )}

      {/* Main Conversation Container */}
      <main
        style={{
          flex: 1,
          maxWidth: '860px',
          width: '100%',
          margin: '0 auto',
          padding: '24px 20px 140px 20px',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Empty State (when conversation has no messages) */}
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '80px',
              textAlign: 'center'
            }}
            className="animate-fade-in"
          >
            {/* Minimalist Orbit Ring icon */}
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                border: '1px solid #27272a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#0c0c0e',
                marginBottom: '24px'
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="m4.93 4.93 4.24 4.24" />
                <path d="m14.83 9.17 4.24-4.24" />
                <path d="m14.83 14.83 4.24 4.24" />
                <path d="m9.17 14.83-4.24 4.24" />
              </svg>
            </div>

            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 600,
                color: '#ffffff',
                marginBottom: '10px',
                letterSpacing: '-0.02em'
              }}
            >
              What's on the agenda today?
            </h1>
            <p style={{ fontSize: '0.88rem', color: '#71717a', maxWidth: '440px', marginBottom: '32px' }}>
              Ask anything. Requests automatically route through active key pools with sub-millisecond cache returns and failsafe failover.
            </p>
          </div>
        )}

        {/* Message Thread */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }} className="animate-fade-in">
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: '#71717a' }}>
                    USER
                  </div>
                  <div
                    style={{
                      fontSize: '0.94rem',
                      lineHeight: 1.6,
                      color: '#ffffff',
                      wordBreak: 'break-word'
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === 'error') {
              return (
                <div
                  key={msg.id}
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    color: '#f87171'
                  }}
                  className="animate-fade-in"
                >
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '2px' }}>
                      Request Failed
                    </div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>{msg.content}</div>
                  </div>
                </div>
              );
            }

            // Assistant Reply Card (Exact contract matches Section 5)
            const meta = msg.metadata;
            const isCache = meta?.resolution_source === 'LLM_CACHE';

            return (
              <div
                key={msg.id}
                data-testid="assistant-message"
                style={{
                  backgroundColor: '#121215',
                  border: '1px solid #232328',
                  borderRadius: '16px',
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                }}
                className="animate-fade-in"
              >
                {/* Assistant Card Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: '#1f1f24',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Sparkles size={11} color="#a855f7" />
                    </div>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#f4f4f5' }}>Lyftr AI</span>
                  </div>

                  {/* data-testid="meta-source" */}
                  {meta && (
                    <span
                      data-testid="meta-source"
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        padding: '3px 9px',
                        borderRadius: '6px',
                        fontFamily: 'JetBrains Mono, monospace',
                        backgroundColor: isCache ? 'rgba(14, 165, 233, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                        color: isCache ? '#38bdf8' : '#34d399',
                        border: isCache ? '1px solid rgba(14, 165, 233, 0.35)' : '1px solid rgba(16, 185, 129, 0.35)',
                        boxShadow: isCache ? '0 0 10px rgba(14, 165, 233, 0.15)' : '0 0 10px rgba(16, 185, 129, 0.15)'
                      }}
                    >
                      {meta.resolution_source}
                    </span>
                  )}
                </div>

                {/* Assistant Reply Text with GFM Markdown and Tables */}
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>

                {/* Divider Line */}
                <div style={{ height: '1px', backgroundColor: '#1f1f24', width: '100%' }} />

                {/* Metadata Section */}
                {meta && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', color: '#71717a' }}>
                      REQUEST METADATA
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '12px'
                      }}
                    >
                      {/* Model */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Model</span>
                        <span
                          data-testid="meta-model"
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 500,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: '#d4d4d8',
                            wordBreak: 'break-all'
                          }}
                        >
                          {meta.model}
                        </span>
                      </div>

                      {/* Latency */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Latency</span>
                        <span
                          data-testid="meta-latency"
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: isCache ? '#38bdf8' : '#e4e4e7'
                          }}
                        >
                          {meta.latency_ms} ms
                        </span>
                      </div>

                      {/* Input Tokens */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Input tokens</span>
                        <span
                          data-testid="meta-input-tokens"
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: '#d4d4d8'
                          }}
                        >
                          {meta.input_tokens}
                        </span>
                      </div>

                      {/* Output Tokens */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Output tokens</span>
                        <span
                          data-testid="meta-output-tokens"
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: '#d4d4d8'
                          }}
                        >
                          {meta.output_tokens}
                        </span>
                      </div>

                      {/* Key ID (Bonus Tracking info) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Fulfillment Key</span>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 500,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: meta.key_id ? '#a1a1aa' : '#52525b'
                          }}
                        >
                          {meta.key_id || 'null (cache)'}
                        </span>
                      </div>

                      {/* Fallback Attempts */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Fallbacks</span>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: meta.fallback_attempts > 0 ? '#f59e0b' : '#71717a'
                          }}
                        >
                          {meta.fallback_attempts}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Loading indicator */}
          {isLoading && (
            <div
              style={{
                backgroundColor: '#121215',
                border: '1px solid #232328',
                borderRadius: '16px',
                padding: '18px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
              className="animate-fade-in"
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: '2px solid #3b82f6',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite'
                }}
              />
              <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>
                Routing query through LiteLLM gateway...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Floating Bottom Input Capsule (Centered layout inspired by screenshot) */}
      <footer
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(to top, #000000 60%, rgba(0,0,0,0) 100%)',
          padding: '100px 20px 24px 20px',
          display: 'flex',
          marginLeft:'auto',
          marginRight: 'auto',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 30
        }}
      >
        <div
          style={{
            maxWidth: '820px',
            width: '100%',
            backgroundColor: '#141417',
            border: '1px solid #28282e',
            borderRadius: '25px',
            padding: '6px 12px 6px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.8)'
          }}
        >
          {/* Left Action Icon */}
          <button
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
            title="Toggle System Prompt"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#1c1c20',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a1a1aa',
              cursor: 'pointer'
            }}
            className="dark-blue-hover"
          >
            <span style={{ fontSize: '18px', fontWeight: 300, lineHeight: 1 }}>+</span>
          </button>

          {/* data-testid="chat-input" */}
          <input
            data-testid="chat-input"
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask, create images, or build anything..."
            disabled={isLoading}
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#ffffff',
              fontSize: '0.94rem',
              padding: '10px 0'
            }}
          />

          {/* data-testid="send-button" */}
          <button
            data-testid="send-button"
            onClick={() => handleSendMessage()}
            disabled={isLoading || !inputMessage.trim()}
            title="Send Message (Enter)"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: inputMessage.trim() ? '#27272a' : '#1c1c20',
              border: '1px solid #323238',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: inputMessage.trim() ? '#ffffff' : '#71717a',
              cursor: inputMessage.trim() && !isLoading ? 'pointer' : 'default',
              opacity: isLoading ? 0.5 : 1
            }}
            className="dark-blue-hover"
          >
            <ArrowUp size={18} />
          </button>
        </div>

        {/* Footer Subtext */}
        <div
          style={{
            fontSize: '0.68rem',
            color: '#52525b',
            marginTop: '8px',
            textAlign: 'center'
          }}
        >
          Lyftr AI Engine • Multi-Key Failover (Gemini / GPT-OSS 20B) • Response Caching Active
        </div>
      </footer>

      {/* Global CSS for spinner */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

