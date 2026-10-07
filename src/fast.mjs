import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const provider = 'openai-codex';
const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode });

// Patch the adapter's collection, where SSE and WebSocket share the same
// payload hook. Never patch global fetch or share a mutable request tier.
export function installFastRequests(ctx, enabled) {
  const runtime = ctx.llm[Symbol.for('cordis.original')] ?? ctx.llm;
  const adapters = new Map(), collections = new Map();
  let active = true;
  const collection = models => {
    if (!models || collections.has(models)) return;
    const original = models.streamSimple;
    if (typeof original !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(models, 'streamSimple');
    const wrapped = function(model, context, options) {
      if (!active || model.provider !== provider) return original.call(this, model, context, options);
      const fast = Boolean(options?.sessionId && enabled(String(options.sessionId)));
      const { serviceTier: _tier, onPayload, ...rest } = options ?? {};
      return original.call(this, model, context, {
        ...rest, ...(fast ? { serviceTier: 'priority' } : {}),
        async onPayload(payload, requestModel) {
          const transformed = await onPayload?.(payload, requestModel);
          const next = { ...(transformed ?? payload) };
          if (fast) next.service_tier = 'priority';
          else delete next.service_tier;
          return next;
        },
      });
    };
    models.streamSimple = wrapped;
    collections.set(models, { original, descriptor, wrapped });
  };
  const reconcile = () => {
    const adapter = runtime.adapters?.get(provider)?.adapter;
    if (!adapter || typeof adapter.current !== 'function') return;
    if (!adapters.has(adapter)) {
      const original = adapter.current, descriptor = Object.getOwnPropertyDescriptor(adapter, 'current');
      const wrapped = function(...args) {
        const snapshot = original.apply(this, args);
        if (active) collection(snapshot.models);
        return snapshot;
      };
      adapter.current = wrapped;
      adapters.set(adapter, { original, descriptor, wrapped });
    }
    collection(adapter.current().models);
  };
  reconcile();
  const off = ctx.on('llm/adapters-updated', reconcile, { global: true });
  return {
    ready() { reconcile(); return Boolean(adapters.has(runtime.adapters?.get(provider)?.adapter)); },
    close() {
      active = false; off?.();
      for (const [key, records] of [['current', adapters], ['streamSimple', collections]]) {
        for (const [target, record] of records) {
          if (target[key] !== record.wrapped) continue;
          if (record.descriptor) Object.defineProperty(target, key, record.descriptor);
          else delete target[key];
        }
      }
    },
  };
}

export function createFastService(ctx, options = {}) {
  const directory = options.directory ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-chatgpt-login', 'fast-sessions');
  const states = new Map(), writes = new Map();
  const validId = id => { if (typeof id !== 'string' || !id || id.length > 200 || id.includes('\0')) throw fail('会话编号无效'); return id; };
  const filename = id => join(directory, createHash('sha256').update(validId(id)).digest('hex') + '.json');
  const state = id => {
    validId(id);
    if (!states.has(id)) {
      let stored;
      try { stored = JSON.parse(readFileSync(filename(id), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw fail('Fast 设置读取失败', 503); }
      if (stored !== undefined && (typeof stored.enabled !== 'boolean' || !Number.isSafeInteger(stored.revision) || stored.revision < 0)) throw fail('Fast 设置格式无效', 503);
      states.set(id, stored ?? { enabled: false, revision: 0 });
    }
    return states.get(id);
  };
  const requests = options.requests ?? installFastRequests(ctx, id => state(id).enabled);
  async function view(id) {
    validId(id);
    let session = ctx.get('sessions')?.get(id);
    if (!session) {
      const resolved = await ctx.get('sessionController')?.resolveAgent(id);
      if (resolved?.error) throw fail('会话不可用', 404);
      session = resolved?.agent?.session;
    }
    if (!session) throw fail('会话不存在', 404);
    const selection = ctx.get('sessionProjections')?.stateOf(session, 'modelSelection');
    const route = selection?.pending ?? selection?.next ?? selection?.lastUsed ?? session.requestHeader?.()?.config ?? ctx.get('agentDefaultModel')?.currentSelection();
    const available = route?.provider === provider && requests.ready();
    const saved = state(id);
    return { available, enabled: available && saved.enabled, revision: saved.revision };
  }
  async function set(id, input) {
    validId(id);
    const previous = writes.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if (typeof input?.enabled !== 'boolean' || !Number.isSafeInteger(input.expectedRevision)) throw fail('Fast 设置无效');
      const before = await view(id);
      if (!before.available) throw fail('Fast 仅支持 ChatGPT 渠道', 409);
      if (before.revision !== input.expectedRevision) throw fail('Fast 设置已更新，请重试', 409);
      const next = { enabled: input.enabled, revision: before.revision + 1 };
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = filename(id) + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, JSON.stringify(next) + '\n', { mode: 0o600 });
      renameSync(temporary, filename(id));
      states.set(id, next);
      return view(id);
    });
    writes.set(id, operation);
    try { return await operation; }
    finally { if (writes.get(id) === operation) writes.delete(id); }
  }
  return { view, set, async close() { requests.close(); await Promise.allSettled(writes.values()); } };
}
