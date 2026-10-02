'use strict';
const fs = require('fs');

function firstNumeric(...values) {
  for (const v of values) { if (Number.isFinite(v)) return v; }
  return 0;
}

function cacheReadTokens(usage) {
  return firstNumeric(
    usage.cache_read_input_tokens, usage.cache_read_tokens,
    usage.prompt_cache_read_tokens, usage.cached_tokens, usage.cached_input_tokens,
    usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens,
    usage.input_token_details && usage.input_token_details.cached_tokens,
    usage.input_tokens_details && usage.input_tokens_details.cached_tokens
  );
}

// Read metadata once; token accounting belongs exclusively to ccusage.
function readCodexSessionMeta(fpath) {
  let meta = null;
  let firstUserPrompt = null;
  for (const line of fs.readFileSync(fpath, 'utf8').split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch (_) { continue; }
    if (!event || typeof event !== 'object') continue;
    if (!meta && event.type === 'session_meta' && event.payload) meta = event.payload;
    // First user message text — used as session_title.
    if (!firstUserPrompt && event.role === 'user' && typeof event.content === 'string') {
      firstUserPrompt = event.content;
    } else if (!firstUserPrompt && event.role === 'user' && Array.isArray(event.content)) {
      for (const c of event.content) {
        if (c && typeof c.text === 'string') { firstUserPrompt = c.text; break; }
        else if (typeof c === 'string') { firstUserPrompt = c; break; }
      }
    } else if (!firstUserPrompt && event.payload && event.payload.role === 'user') {
      const c = event.payload.content;
      if (typeof c === 'string') firstUserPrompt = c;
      else if (Array.isArray(c)) {
        for (const item of c) {
          if (item && typeof item.text === 'string') { firstUserPrompt = item.text; break; }
        }
      }
    }
  }
  // Trim title to 200 chars, strip environment_context wrappers.
  let title = null;
  if (firstUserPrompt) {
    title = firstUserPrompt
      .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!title) title = null;
  }

  return { id: meta?.id, timestamp: meta?.timestamp, cwd: meta?.cwd || null, title };
}

module.exports = { firstNumeric, cacheReadTokens, readCodexSessionMeta };
