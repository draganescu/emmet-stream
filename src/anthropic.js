// Minimal streaming client for the Anthropic Messages API, called straight from
// the browser with the user's own key. The page's Content Security Policy only
// allows connections to api.anthropic.com.

export const MODELS = [
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-fable-5-1', 'Fable 5.1'],
];
export const EFFORTS = [['', 'Model default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
// Models that accept output_config.effort (see platform.claude.com/docs/en/build-with-claude/effort)
export const supportsEffort = model => /^claude-(sonnet-5|opus-5|fable-5|mythos-5)/.test(model);
export const modelLabel = id => (MODELS.find(([m]) => m === id) || [id, id])[1];

/**
 * Stream one user prompt. Resolves {text, usage: {input, output}, stop}.
 * Rejects {code, message}; code is one of cancelled, auth, rate_limited,
 * overloaded, network, http, api.
 */
export async function callClaude({ key, model, effort, prompt, maxTokens, signal, onText }) {
  const body = { model, max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] };
  if (effort && supportsEffort(model)) body.output_config = { effort };
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw e && e.name === 'AbortError' ? { code: 'cancelled' } : { code: 'network', message: String(e && e.message || e) };
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) message = j.error.message; } catch {}
    const code = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limited' : res.status === 529 ? 'overloaded' : 'http';
    throw { code, message };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stop = null;
  const usage = { input: 0, output: 0 };
  const handle = evt => {
    const data = evt.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    let j; try { j = JSON.parse(data); } catch { return; }
    switch (j.type) {
      case 'message_start': {
        const u = (j.message && j.message.usage) || {};
        usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        usage.output = u.output_tokens || 0;
        break;
      }
      case 'content_block_delta':
        if (j.delta && j.delta.type === 'text_delta' && j.delta.text) { text += j.delta.text; onText && onText({ text, delta: j.delta.text }); }
        break;
      case 'message_delta':
        if (j.usage && j.usage.output_tokens != null) usage.output = j.usage.output_tokens;
        if (j.delta && j.delta.stop_reason) stop = j.delta.stop_reason;
        break;
      case 'error':
        throw { code: j.error && j.error.type === 'overloaded_error' ? 'overloaded' : 'api', message: (j.error && j.error.message) || 'stream error' };
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    if (buf.trim()) handle(buf);
  } catch (e) {
    if (e && e.code) throw e;
    throw e && e.name === 'AbortError' ? { code: 'cancelled' } : { code: 'network', message: String(e && e.message || e) };
  }
  return { text, usage, stop };
}
