export function formatStatus(state) {
  const lines = [state.configured ? 'ChatGPT 已连接。' : 'ChatGPT 尚未连接。'];
  const attempt = state.attempt;
  if (attempt?.phase === 'waiting') {
    const notice = attempt.notices.findLast(item => item.url) ?? attempt.notices.at(-1);
    if (notice?.message) lines.push(notice.message);
    if (notice?.url) lines.push(notice.url);
    if (notice?.code) lines.push(`授权码：${notice.code}`);
    if (attempt.prompt) {
      lines.push(attempt.prompt.message);
      if (attempt.prompt.kind === 'select') lines.push('选择：/chatgpt answer ' + attempt.prompt.options.map(option => option.id).join(' | '));
      else lines.push('浏览器回调可自动完成；需要手动提交时：/chatgpt answer <授权码或回调地址>');
    }
    lines.push('查看结果：/chatgpt status；取消：/chatgpt cancel');
  } else if (attempt?.phase === 'failed') lines.push(attempt.error);
  else if (attempt?.phase === 'cancelled') lines.push('当前登录已取消。');
  return lines.filter(Boolean).join('\n');
}

export function createCommand(service) {
  return { name: 'chatgpt', description: '登录或退出 ChatGPT', recordInput: false,
    input: { hint: 'login [browser|device_code] | status | answer <code> | cancel | logout' },
    async handler({ rawInput, signal }) {
      const input = rawInput.trim(), [action = 'status', ...args] = input.split(/\s+/);
      try {
        let state;
        switch (action) {
          case 'status': state = await service.status(); break;
          case 'login': {
            state = await service.start(args[0] ?? 'browser');
            // The provider may import its OAuth implementation lazily. Return
            // its browser URL as soon as it arrives, with a bounded wait.
            for (let i = 0; i < 30 && state.attempt?.phase === 'waiting' && !state.attempt.prompt && !state.attempt.notices.some(item => item.url); i++) {
              if (signal?.aborted) break;
              await new Promise(resolve => setTimeout(resolve, 100)); state = await service.status();
            }
            break;
          }
          case 'answer': {
            const current = (await service.status()).attempt;
            if (!current?.prompt) return { kind: 'error', text: '当前没有等待提交的登录信息。' };
            state = await service.answer(current.id, current.prompt.id, input.slice('answer'.length).trim()); break;
          }
          case 'cancel': {
            const current = (await service.status()).attempt;
            if (!current) return { kind: 'success', text: '当前没有待取消的登录。' };
            state = await service.cancel(current.id); break;
          }
          case 'logout': state = await service.logout(); break;
          default: return { kind: 'error', text: '使用 /chatgpt login、status、answer、cancel 或 logout。' };
        }
        return { kind: 'success', text: formatStatus(state) };
      } catch (error) { return { kind: 'error', text: error.statusCode ? error.message : 'ChatGPT 操作未完成，请检查登录与模型配置。' }; }
    } };
}
