'use strict';
const https = require('node:https');

const HOSTS = new Set(['raw.githubusercontent.com', 'music.163.com', 'y.music.163.com', '163cn.tv', 'y.qq.com', 'c.y.qq.com', 'u.y.qq.com']);

function request(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !HOSTS.has(target.hostname) || target.username || target.password || (target.port && target.port !== '443')) return reject(new Error('不允许访问此地址'));
    if (redirects > 4) return reject(new Error('链接重定向次数过多'));
    const { body, method = 'GET', headers = {}, maxBytes = 24 * 1024 * 1024, timeout = 20000 } = options;
    const req = https.request(target, {
      method, headers: { 'User-Agent': 'AMLL-Resolve-Workflow/0.1', 'Accept-Encoding': 'identity', ...headers },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        // 分享链接只允许在白名单内跳转；带请求体的 API 不自动跨域转发。
        if (method !== 'GET') return reject(new Error('平台接口已重定向，请更新适配器'));
        request(new URL(res.headers.location, target).href, options, redirects + 1).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) {
        res.resume(); const error = new Error(`网络请求失败 HTTP ${res.statusCode}（${target.hostname}）`); error.status = res.statusCode; reject(error); return;
      }
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error('响应超过大小限制')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: target.href }));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('请求超时，请检查网络后重试')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function json(url, options) {
  const response = await request(url, options);
  try { return JSON.parse(response.text); } catch { throw new Error('平台返回的不是 JSON，可能需要登录或接口发生变化'); }
}
module.exports = { request, json };
