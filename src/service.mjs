import { randomUUID } from 'node:crypto';

export const PROVIDER = 'openai-codex';
export const RECORD_KEY = 'llm-pi-ai/openai-codex';
const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode });
function claims(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { return {}; } }

export function modelsFromCatalog(document, plan) {
  const ids = new Set();
  return (document.models ?? []).flatMap(model => {
    const id = model.slug ?? model.id;
    if (typeof id !== 'string' || !id || ids.has(id) || model.supported_in_api === false) return [];
    if (plan && model.available_in_plans?.length && !model.available_in_plans.includes(plan)) return [];
    ids.add(id);
    const entry = { id, name: model.display_name ?? id };
    const contextWindow = [model.max_context_window, model.context_window].find(value => Number.isSafeInteger(value) && value > 0);
    if (contextWindow !== undefined) entry.contextWindow = contextWindow;
    const input = model.input_modalities?.filter(value => ['text','image'].includes(value));
    if (input?.length) entry.input = input;
    const efforts = Object.fromEntries((model.supported_reasoning_levels ?? []).filter(value => ['minimal','low','medium','high','xhigh','max'].includes(value.effort)).map(value => [value.effort, value.effort]));
    if (Object.keys(efforts).length) entry.reasoningEfforts = efforts;
    return [entry];
  });
}

async function accountCatalog(credential) {
  const auth = claims(credential.access)['https://api.openai.com/auth'] ?? {};
  const response = await fetch('https://chatgpt.com/backend-api/codex/models?client_version=0.160.0', {
    headers: { Authorization: 'Bearer ' + credential.access, 'ChatGPT-Account-Id': credential.accountId ?? auth.chatgpt_account_id, originator: 'dsh-chatgpt-login' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw fail('暂时无法读取 ChatGPT 模型目录，请稍后重试', 502);
  return modelsFromCatalog(await response.json(), auth.chatgpt_plan_type);
}

function publicNotice(notice) {
  let url;
  try { const parsed = new URL(notice.url); if (parsed.protocol === 'https:' && ['auth.openai.com','chatgpt.com'].includes(parsed.hostname)) url = parsed.href; } catch {}
  return { message: String(notice.message ?? '').slice(0,4000), ...(url ? { url } : {}), ...(notice.code ? { code: String(notice.code).slice(0,256) } : {}) };
}

export function createChatGPTService(ctx, options = {}) {
  let attempt, closed = false, writes = Promise.resolve(), channelTask, hydrated = false;
  const get = name => ctx.get(name);
  const serial = task => { const next = writes.then(task); writes = next.catch(() => {}); return next; };
  const loadCatalog = options.loadCatalog ?? accountCatalog;

  async function enable() {
    const settings = get('settings'), record = await get('credentials').readRecord(RECORD_KEY);
    if (record?.kind !== 'grant') throw fail('请先登录 ChatGPT');
    if (!settings?.writable) throw fail('当前 DSH 配置不可写',503);
    const models = await loadCatalog(record.payload);
    if (!models.length) throw fail('该账号暂时没有可用的 GPT 模型',502);
    for (let retry = 0; retry < 4; retry++) {
      const row = settings.describe().find(item => item.ns === 'llm-pi-ai');
      if (!row) throw fail('当前 DSH 未加载 Pi AI 模型适配器',503);
      try {
        // The catalog provider owns both the endpoint and OAuth authentication.
        await settings.replace(row.ns,{...row.value,providers:{...row.value?.providers,[PROVIDER]:{displayName:'ChatGPT',models}}},row.revision);
        return;
      } catch (error) { if (error.code !== 'SETTINGS_CONFLICT' || retry === 3) throw error; }
    }
  }
  function ensureEnabled() { channelTask ??= enable().then(() => { hydrated = true; }).finally(() => { channelTask = undefined; }); return channelTask; }

  async function status() {
    const credentials = get('credentials'), flow = get('authorization')?.describe(RECORD_KEY), info = await credentials?.describeRecord(RECORD_KEY);
    const available = Boolean(flow && credentials && get('settings')), configured = Boolean(info?.configured && info.kind === 'grant');
    let error;
    if (configured && !hydrated) {
      try { await ensureEnabled(); } catch { error = '模型目录暂时无法同步，请稍后重试'; }
    }
    const models = configured ? await get('llm').listModels(PROVIDER).catch(() => []) : [];
    return { available, configured, modelsCount: models.length, ...(error ? {error} : {}), attempt: attempt ? {id:attempt.id,phase:attempt.phase,notices:attempt.notices,prompt:attempt.prompt?.public,error:attempt.error} : null };
  }

  async function beginLogin(preferredMode) {
    if (preferredMode !== undefined && !['browser','device_code'].includes(preferredMode)) throw fail('登录方式无效');
    if (closed) throw fail('ChatGPT 登录服务已停止',503);
    const auth = get('authorization');
    if (attempt?.phase === 'waiting' || auth?.describe(RECORD_KEY)?.inFlight) throw fail('已有 ChatGPT 登录正在进行',409);
    if (!auth?.describe(RECORD_KEY)?.methods.some(method => method.id === 'oauth')) throw fail('当前 DSH 没有 ChatGPT OAuth 登录，请升级 DSH',503);
    const current = {id:randomUUID(),phase:'waiting',notices:[],controller:new AbortController()}; attempt = current;
    const timer = setTimeout(() => current.controller.abort(),options.timeoutMs ?? 600000); timer.unref?.();
    const prompt = input => {
      if (preferredMode && input.kind === 'select' && input.options.some(option => option.id === preferredMode)) return Promise.resolve(preferredMode);
      return new Promise((resolve,reject) => {
        const id = randomUUID(), signal = input.signal;
        const publicPrompt = {id,kind:input.kind,message:String(input.message ?? '').slice(0,4000),placeholder:input.placeholder,...(input.kind === 'select' ? {options:input.options.map(({id,label,description}) => ({id,label,description}))} : {})};
        const clean = () => { signal?.removeEventListener('abort',abort); current.controller.signal.removeEventListener('abort',abort); if (current.prompt?.public.id === id) current.prompt = undefined; };
        const abort = () => { clean(); reject(Error('登录输入已撤回')); };
        current.prompt = {public:publicPrompt,answer(value){clean();resolve(value);}};
        if (signal?.aborted || current.controller.signal.aborted) abort();
        else {signal?.addEventListener('abort',abort,{once:true});current.controller.signal.addEventListener('abort',abort,{once:true});}
      });
    };
    current.done = Promise.resolve().then(() => auth.begin({key:RECORD_KEY,method:'oauth',signal:current.controller.signal,interaction:{notify(notice){current.notices=[...current.notices.slice(-7),publicNotice(notice)];},prompt}}))
      .then(async result => {if(result.status === 'authorized') await ensureEnabled();current.phase=result.status;})
      .catch(() => {current.phase=current.controller.signal.aborted?'cancelled':'failed';current.error=current.phase === 'failed'?'ChatGPT 登录未完成，请重试':undefined;})
      .finally(() => {clearTimeout(timer);current.prompt=undefined;});
    return status();
  }
  async function answer(id,promptId,value) {
    if (!attempt || attempt.id !== id || attempt.phase !== 'waiting' || attempt.prompt?.public.id !== promptId) throw fail('此登录输入已失效，请刷新后重试',409);
    if (typeof value !== 'string' || value.length > 16384 || !value.trim()) throw fail('请输入有效的登录信息');
    const prompt = attempt.prompt;
    if (prompt.public.kind === 'select' && !prompt.public.options.some(option => option.id === value)) throw fail('登录选项无效');
    prompt.answer(value);return status();
  }
  async function cancel(id) {
    if (!attempt || attempt.id !== id) throw fail('登录已结束或已在其他页面更新',409);
    attempt.controller.abort();await attempt.done;return status();
  }
  async function logout() {
    return serial(async () => {
      if (get('authorization')?.describe(RECORD_KEY)?.inFlight && attempt?.phase !== 'waiting') throw fail('其他页面正在登录，请先结束该登录',409);
      if (attempt?.phase === 'waiting') {attempt.controller.abort();await attempt.done;}
      await get('credentials').deleteRecord(RECORD_KEY);
      const settings = get('settings');
      for (let retry=0;retry<4;retry++) {
        const row=settings.describe().find(item=>item.ns==='llm-pi-ai');
        if(!row?.value?.providers?.[PROVIDER]) break;
        const providers={...row.value.providers};delete providers[PROVIDER];
        try {await settings.replace(row.ns,{...row.value,providers},row.revision);break;}
        catch(error){if(error.code!=='SETTINGS_CONFLICT'||retry===3)throw error;}
      }
      attempt=undefined;hydrated=false;return status();
    });
  }
  return {status,start:mode=>serial(()=>beginLogin(mode)),answer,cancel,logout,
    async close(){closed=true;attempt?.controller.abort();await Promise.allSettled([attempt?.done,writes,channelTask]);}};
}
