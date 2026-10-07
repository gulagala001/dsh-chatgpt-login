import { createChatGPTService } from './service.mjs';
import { createCommand } from './command.mjs';
import { createFastService } from './fast.mjs';

export const name = 'dsh-chatgpt-login';
export const inject = ['credentials', 'authorization', 'settings', 'llm'];

async function readBody(req) {
  let size = 0, body = '';
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw Object.assign(Error('请求内容过长'), { statusCode: 413 }); body += chunk; }
  try { return JSON.parse(body); } catch { throw Error('请求格式无效'); }
}
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }

export function createHandler(ctx, service, fast) {
  return async (req, res) => {
    const denied = ctx.get('connection')?.requestRejection(req);
    if (denied !== undefined || !ctx.get('connection')) { res.writeHead(denied ?? 503); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/dsh-chatgpt-login/fast' && fast) {
        const id = url.searchParams.get('session');
        if (req.method === 'GET') { send(res, 200, await fast.view(id)); return; }
        if (req.method !== 'POST') { send(res, 405, { error: '不支持此方法' }); return; }
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { send(res, 403, { error: '请求来源无效' }); return; }
        send(res, 200, await fast.set(id, await readBody(req))); return;
      }
      if (url.pathname !== '/dsh-chatgpt-login/api') { send(res, 404, { error: '接口不存在' }); return; }
      if (req.method === 'GET') { send(res, 200, await service.status()); return; }
      if (req.method !== 'POST') { send(res, 405, { error: '不支持此方法' }); return; }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { send(res, 403, { error: '请求来源无效' }); return; }
      const input = await readBody(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请求格式无效');
      let value;
      switch (input.action) {
        case 'login': value = await service.start('browser'); break;
        case 'answer': value = await service.answer(input.attemptId, input.promptId, input.value); break;
        case 'cancel': value = await service.cancel(input.attemptId); break;
        case 'logout': value = await service.logout(); break;
        default: throw Error('未知操作');
      }
      send(res, 200, value);
    } catch (error) { send(res, error.statusCode ?? 400, { error: error.statusCode ? error.message : '操作未完成，请检查 DSH 状态后重试' }); }
  };
}

export function apply(ctx) {
  const service = createChatGPTService(ctx);
  const fast = createFastService(ctx);
  ctx.inject(['webServer', 'connection'], web => web.effect(() => web.webServer.register({ kind: 'prefix', path: '/dsh-chatgpt-login', handler: createHandler(web, service, fast) })));
  ctx.inject(['commands'], commands => commands.effect(() => commands.commands.register(createCommand(service))));
  ctx.effect(() => () => Promise.all([service.close(), fast.close()]));
}
