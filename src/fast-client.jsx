import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

const empty = { subscribe: () => () => {}, getSnapshot: () => undefined };
export function FastButton({ ctx, sessionId, locked }) {
  const store = useMemo(() => ctx.get('sessions')?.binding(sessionId)?.session.projections.faceOf('modelSelection') ?? empty, [ctx, sessionId]);
  const selection = useSyncExternalStore(fn => store.subscribe(fn), () => store.getSnapshot());
  const current = selection?.next ?? selection?.lastUsed;
  const [state, setState] = useState(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), writing = useRef(false);
  const endpoint = 'dsh-chatgpt-login/fast?session=' + encodeURIComponent(sessionId);
  useEffect(() => {
    const controller = new AbortController(), ticket = ++generation.current;
    setState(undefined); setError('');
    fetch(endpoint, { signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw Error(value.error || 'Fast 状态暂不可用');
      if (ticket === generation.current) setState({ ...value, sessionId });
    }).catch(e => { if (!controller.signal.aborted && ticket === generation.current) setError(e.message); });
    return () => { ++generation.current; controller.abort(); };
  }, [endpoint, current?.provider, current?.model]);
  const enabled = Boolean(state?.sessionId === sessionId && state.available && state.enabled);
  const toggle = async () => {
    if (!state?.available || writing.current || locked) return;
    writing.current = true; setBusy(true); setError('');
    const ticket = generation.current;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled, expectedRevision: state.revision }) });
      const value = await response.json(); if (!response.ok) throw Error(value.error || 'Fast 切换失败');
      if (ticket === generation.current) setState({ ...value, sessionId });
    } catch (e) { if (ticket === generation.current) setError(e.message); }
    finally { writing.current = false; setBusy(false); }
  };
  if (!sessionId || state?.sessionId !== sessionId || !state.available || (current?.provider && current.provider !== 'openai-codex')) return null;
  return <button type="button" className="dsh-chatgpt-fast" aria-label="Fast 模式" aria-pressed={enabled}
    disabled={locked || busy || !state?.available} onClick={() => void toggle()}
    title={error || (!state?.available ? 'Fast 仅支持 ChatGPT 渠道' : enabled ? 'Fast 已开启 · 点击关闭' : 'Fast 已关闭 · 点击开启')}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill={enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z"/></svg>
  </button>;
}

export function installFastButton(ctx) {
  const name = 'conversation.input.right';
  function Button(props) { return <FastButton ctx={ctx} {...props}/>; }
  ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'dsh-chatgpt-fast', order: 110 }, Button));
}
