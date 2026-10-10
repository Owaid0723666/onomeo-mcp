// Self-check: starts the server over stdio and drives it with raw JSON-RPC.
// Default: against a local stub. With ONOMEO_LIVE=1 and ONOMEO_API_KEY set: one real call to "auto".
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const live = process.env.ONOMEO_LIVE === '1';

const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d)).on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/info') {
      return res.end(JSON.stringify({ models: ['auto', 'free-a', 'paid-b'], freeModels: ['auto', 'free-a'], rate: { windowMinutes: 300, perAccountWindowMax: 30 }, buy: { enabled: true, priceUsd: 5 } }));
    }
    const { model } = JSON.parse(raw);
    if (req.headers.authorization !== 'Bearer good') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Invalid API key' } })); }
    if (model === 'broken') { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: 'limit reached' } })); }
    res.setHeader('x-onomeo-model', model === 'auto' ? 'free-a' : model);
    res.end(JSON.stringify({ choices: [{ message: { content: `hello from ${model}` } }] }));
  });
});

async function session(env, run) {
  const child = spawn(process.execPath, ['index.mjs'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const mine = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), live ? 130_000 : 10_000);
    pending.set(mine, (msg) => { clearTimeout(timer); resolve(msg.result ?? msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mine, method, params }) + '\n');
  });
  const tool = async (name, args = {}) => {
    const r = await call('tools/call', { name, arguments: args });
    return { text: r.content[0].text, isError: !!r.isError };
  };
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.serverInfo.name, 'onomeo');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await run({ call, tool });
  } finally {
    child.kill();
  }
}

if (live) {
  await session({}, async ({ tool }) => {
    const models = await tool('list_models');
    assert.equal(models.isError, false);
    assert.match(models.text, /^Free \(\d+\): /);
    const answer = await tool('ask_model', { prompt: 'Reply with the single word: pong' });
    console.log(answer.text);
    assert.equal(answer.isError, false);
    assert.match(answer.text, /^\[.+\]\n\S/);
  });
  console.log('live ok');
} else {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const ONOMEO_BASE_URL = `http://127.0.0.1:${stub.address().port}`;

  await session({ ONOMEO_BASE_URL, ONOMEO_API_KEY: 'good' }, async ({ call, tool }) => {
    const { tools } = await call('tools/list', {});
    assert.deepEqual(tools.map((t) => t.name).sort(), ['ask_model', 'compare_models', 'list_models']);

    const models = await tool('list_models');
    assert.match(models.text, /Free \(2\): auto, free-a/);
    assert.match(models.text, /Pay-as-you-go \(1\): paid-b/);
    assert.match(models.text, /30 calls per 5 hours/);

    // "auto" reports the model that actually answered
    assert.deepEqual(await tool('ask_model', { prompt: 'hi' }), { text: '[free-a]\nhello from auto', isError: false });
    assert.deepEqual(await tool('ask_model', { prompt: 'hi', model: 'broken' }), { text: 'limit reached', isError: true });

    // one failing model does not sink the comparison
    const mixed = await tool('compare_models', { prompt: 'hi', models: ['free-a', 'broken'] });
    assert.equal(mixed.isError, false);
    assert.match(mixed.text, /## free-a\nhello from free-a/);
    assert.match(mixed.text, /## broken \(failed\)\nlimit reached/);
    assert.equal((await tool('compare_models', { prompt: 'hi', models: ['broken', 'broken'] })).isError, true);
  });

  await session({ ONOMEO_BASE_URL, ONOMEO_API_KEY: 'bad' }, async ({ tool }) => {
    const r = await tool('ask_model', { prompt: 'hi' });
    assert.equal(r.isError, true);
    assert.match(r.text, /^Invalid API key Create a key at https:\/\/onomeo\.com/);
  });

  // no key: the server still starts and lists models, asking explains how to get a key
  await session({ ONOMEO_BASE_URL, ONOMEO_API_KEY: '' }, async ({ tool }) => {
    assert.equal((await tool('list_models')).isError, false);
    const r = await tool('ask_model', { prompt: 'hi' });
    assert.equal(r.isError, true);
    assert.match(r.text, /ONOMEO_API_KEY is not set/);
  });

  stub.close();
  console.log('ok');
}
