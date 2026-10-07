import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import css from './style.css';
import { installFastButton } from './fast-client.jsx';

async function api(input, signal) {
  const response = await fetch('dsh-chatgpt-login/api',input === undefined ? {signal} : {signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'ChatGPT 登录服务尚未加载');
  return value;
}

export function ChatGPTCard() {
  const [state,setState]=useState(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[manual,setManual]=useState(false),[answer,setAnswer]=useState('');
  const alive=useRef(true),revision=useRef(0),writing=useRef(false),popup=useRef(),openPending=useRef(false),heading=useId();
  const refresh=useCallback(async signal=>{
    if(writing.current)return;
    const ticket=++revision.current;
    try{const next=await api(undefined,signal);if(alive.current&&ticket===revision.current){setState(next);setError('');}}
    catch(e){if(alive.current&&!signal?.aborted&&ticket===revision.current)setError(e.message);}
  },[]);
  useEffect(()=>{
    alive.current=true;const controller=new AbortController();let timer;
    const poll=async()=>{await refresh(controller.signal);if(!controller.signal.aborted)timer=setTimeout(poll,1500);};
    void poll();return()=>{alive.current=false;controller.abort();clearTimeout(timer);if(openPending.current)popup.current?.close();};
  },[refresh]);
  const attempt=state?.attempt,waiting=attempt?.phase==='waiting',prompt=attempt?.prompt;
  const notice=attempt?.notices?.findLast(item=>item.url)??attempt?.notices?.at(-1);
  useEffect(()=>{setAnswer('');setManual(false);},[attempt?.id,prompt?.id]);
  useEffect(()=>{
    if(waiting&&notice?.url&&openPending.current){openPending.current=false;try{popup.current?.location.replace(notice.url);}catch{}}
    if(attempt?.phase==='failed'||attempt?.phase==='cancelled'){if(openPending.current)popup.current?.close();openPending.current=false;}
  },[waiting,notice?.url,attempt?.phase]);
  const act=async input=>{
    if(writing.current)return;
    writing.current=true;++revision.current;setBusy(true);setError('');
    try{const next=await api(input);if(alive.current)setState(next);}
    catch(e){if(openPending.current)popup.current?.close();openPending.current=false;if(alive.current)setError(e.message);}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  };
  const login=()=>{popup.current=window.open('about:blank','_blank');if(popup.current)popup.current.opener=null;openPending.current=Boolean(popup.current);void act({action:'login'});};
  return <section className="dsh-chatgpt-login-card" aria-labelledby={heading} aria-busy={busy}>
    <div className="dsh-chatgpt-login-heading"><div><h3 id={heading}>ChatGPT</h3><p>{state?.configured?`已登录 · ${state.modelsCount} 个模型已加入渠道`:'登录后，渠道和全部可用模型自动出现'}</p></div>
      <button type="button" disabled={busy||!state?.available} onClick={()=>waiting?void act({action:'cancel',attemptId:attempt.id}):state?.configured?void act({action:'logout'}):login()}>{waiting?'取消登录':state?.configured?'退出登录':'登录 ChatGPT'}</button>
    </div>
    {waiting&&<div className="dsh-chatgpt-login-flow" role="status"><p>请在浏览器完成 ChatGPT 登录。</p>{notice?.url&&<a href={notice.url} target="_blank" rel="noopener noreferrer">打开登录页面 ↗</a>}
      {prompt&&<><button type="button" className="dsh-chatgpt-login-manual" onClick={()=>setManual(!manual)}>无法自动返回？</button>{manual&&<form onSubmit={event=>{event.preventDefault();void act({action:'answer',attemptId:attempt.id,promptId:prompt.id,value:answer});}}>
        {prompt.kind==='select'?<select aria-label="登录选项" value={answer} onChange={event=>setAnswer(event.target.value)}><option value="">请选择</option>{prompt.options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>:<input aria-label="登录回调" type={prompt.kind==='secret'?'password':'text'} placeholder="粘贴授权码或回调地址" autoComplete="off" value={answer} onChange={event=>setAnswer(event.target.value)}/>}
        <button type="submit" disabled={busy||!answer.trim()}>继续</button>
      </form>}</>}
    </div>}
    {(error||state?.error||attempt?.error)&&<p className="dsh-chatgpt-login-error" role="alert">{error||state?.error||attempt.error}</p>}
  </section>;
}

export const inject=['slots'];
export function apply(ctx){
  ctx.effect(()=>{const style=document.createElement('style');style.dataset.plugin='dsh-chatgpt-login';style.textContent=css;document.head.append(style);return()=>style.remove();});
  ctx.slots.inject('settings.models.footer',()=>ctx.slots.register({name:'settings.models.footer',id:'dsh-chatgpt-login',order:-10},ChatGPTCard));
  installFastButton(ctx);
}
