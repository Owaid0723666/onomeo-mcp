#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const VERSION = '0.1.0';
const BASE = (process.env.ONOMEO_BASE_URL || 'https://onomeo.com').replace(/\/+$/, '');
const KEY = process.env.ONOMEO_API_KEY || '';
const SIGNUP = 'https://onomeo.com/?utm_source=mcp';
const UA = `onomeo-mcp/${VERSION}`;

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError && { isError }) });

// One chat call. Returns { ok, model, answer } and never throws, so compare_models can show a partial result.
async function ask(model, prompt, system) {
  if (!KEY) return { ok: false, model, answer: `ONOMEO_API_KEY is not set. Create a free key at ${SIGNUP} and add it to this server's env.` };
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const why = body?.error?.message || `onomeo returned HTTP ${res.status}`;
      return { ok: false, model, answer: res.status === 401 ? `${why} Create a key at ${SIGNUP}` : why };
    }
    const answer = body?.choices?.[0]?.message?.content;
    if (!answer) return { ok: false, model, answer: 'The model returned an empty answer.' };
    // "auto" is served by whichever free model is healthy; report the one that actually answered.
    return { ok: true, model: res.headers.get('x-onomeo-model') || body.model || model, answer };
  } catch (err) {
    return { ok: false, model, answer: err?.name === 'TimeoutError' ? 'No answer within 120 seconds.' : `Could not reach onomeo: ${err?.message || err}` };
  }
}

const server = new McpServer({ name: 'onomeo', version: VERSION });

server.registerTool(
  'list_models',
  {
    description: 'List the models onomeo serves right now: which are free to call, which are pay-as-you-go, and the current free call limit. Works without an API key.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const res = await fetch(`${BASE}/api/info`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return text(`onomeo returned HTTP ${res.status}`, true);
      const info = await res.json();
      const free = info.freeModels || [];
      const paid = (info.models || []).filter((id) => !free.includes(id));
      const rate = info.rate || {};
      return text([
        `Free (${free.length}): ${free.join(', ')}`,
        `Pay-as-you-go (${paid.length}): ${paid.join(', ')}`,
        rate.perAccountWindowMax ? `Free limit: ${rate.perAccountWindowMax} calls per ${rate.windowMinutes / 60} hours per account.` : '',
        info.buy?.enabled ? `Paid models need a top-up, from $${info.buy.priceUsd}: https://onomeo.com/buy` : '',
      ].filter(Boolean).join('\n'));
    } catch (err) {
      return text(`Could not reach onomeo: ${err?.message || err}`, true);
    }
  },
);

const prompt = z.string().min(1).describe('The full question. The other model sees only this text, so include the code or context it needs.');
const system = z.string().optional().describe('Optional system prompt.');

server.registerTool(
  'ask_model',
  {
    description: 'Ask another LLM through onomeo and return its answer. Use it for a second opinion, a review from a different model, or to hand off a side question. "auto" picks a healthy free model.',
    inputSchema: z.object({
      prompt,
      model: z.string().default('auto').describe('Model id from list_models. Defaults to "auto".'),
      system,
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ prompt, model, system }) => {
    const r = await ask(model, prompt, system);
    return text(r.ok ? `[${r.model}]\n${r.answer}` : r.answer, !r.ok);
  },
);

server.registerTool(
  'compare_models',
  {
    description: 'Send the same question to 2-4 models at once and return the answers side by side. Each model counts as one call against the limit.',
    inputSchema: z.object({
      prompt,
      models: z.array(z.string()).min(2).max(4).describe('Model ids from list_models.'),
      system,
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ prompt, models, system }) => {
    const results = await Promise.all(models.map((m) => ask(m, prompt, system)));
    const out = results.map((r) => `## ${r.model}${r.ok ? '' : ' (failed)'}\n${r.answer}`).join('\n\n');
    return text(out, results.every((r) => !r.ok));
  },
);

await server.connect(new StdioServerTransport());
