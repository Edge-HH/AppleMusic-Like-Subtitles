'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ScriptResolveHost } = require('../lib/resolve');

async function fixture(t, reply) {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++;req.resume();req.on('end', () => reply(res)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve);server.closeAllConnections(); }));
  return { host: new ScriptResolveHost(server.address().port, 'test-token'), requests: () => requests };
}

test('长导入不使用普通请求的空闲超时，完成后只报告成功', async t => {
  const request = http.request;
  // Compress the existing 120-second inactivity deadline; keep its actual socket behaviour.
  t.mock.method(http, 'request', (options, callback) => request({ ...options, timeout: options.timeout ? 15 : 0 }, callback));
  const { host } = await fixture(t, res => setTimeout(() => res.end(JSON.stringify({ ok: true, data: { insertedCount: 3 } })), 70));
  assert.equal((await host.render({})).insertedCount, 3);
});

test('流式进度和心跳不是最终结果，最终数据必须等待完成帧', async t => {
  const progress = [];
  const { host } = await fixture(t, res => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const line = JSON.stringify({ type: 'progress', data: { stage: '写入文字', completed: 1, total: 3 } }) + '\n';
    res.write(line.slice(0, 12));res.write(line.slice(12));
    res.write(JSON.stringify({ type: 'heartbeat', elapsedSeconds: 2 }) + '\n');
    setTimeout(() => res.end(JSON.stringify({ ok: true, data: { insertedCount: 3 } }) + '\n'), 20);
  });
  assert.equal((await host.render({}, item => progress.push(item))).insertedCount, 3);
  assert.ok(progress.some(item => item.completed === 1));
});

test('收到流式错误时显示宿主原因，不把 HTTP 200 误判为成功', async t => {
  const { host } = await fixture(t, res => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write('{"type":"heartbeat","elapsedSeconds":1}\n');
    res.end('{"ok":false,"error":"无法创建轨道"}\n');
  });
  await assert.rejects(host.render({}), /无法创建轨道/);
});

test('没有最终结果就断线时提示结果不确定且不自动重发写入', async t => {
  const { host, requests } = await fixture(t, res => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end('{"type":"heartbeat","elapsedSeconds":1}\n');
  });
  await assert.rejects(host.render({}), /可能仍在执行|结果不确定/);
  assert.equal(requests(), 1);
});
