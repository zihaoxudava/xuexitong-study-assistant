import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { emptyState, ingest, trim } from './lib/model.mjs';
import { draftAnswer } from './lib/ai.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
function demoWav() {
  const wav = Buffer.alloc(44 + 8000 * 2 * 12);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  return wav;
}
export async function loadEnv() {
  try {
    const env = await readFile(path.join(root,'.env'),'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*(OPENAI_API_KEY|OPENAI_MODEL)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function createApp({ dataDir = path.join(root,'data'), port = 18765, apiKey = process.env.OPENAI_API_KEY || '', model = process.env.OPENAI_MODEL || 'gpt-4.1-mini', fetchImpl } = {}) {
  await mkdir(dataDir, { recursive:true });
  let token;
  try { token = (await readFile(path.join(dataDir,'pairing-token'),'utf8')).trim(); }
  catch (error) { if(error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('hex'); await writeFile(path.join(dataDir,'pairing-token'),token,{mode:0o600}); }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('配对码文件无效，请备份 data 后移走 pairing-token 并重启');
  let state;
  try { state = JSON.parse(await readFile(path.join(dataDir,'state.json'),'utf8')); if(state.version !== 1 || !state.sections || !state.questions) throw new Error('数据版本不兼容'); }
  catch(error) { if(error.code !== 'ENOENT') throw error; state = emptyState(); }
  let writeQueue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(state, null, 2);
    const operation = writeQueue.then(async () => { await writeFile(path.join(dataDir,'state.tmp'), snapshot); await rename(path.join(dataDir,'state.tmp'), path.join(dataDir,'state.json')); });
    writeQueue = operation.catch(() => {});
    return operation;
  };
  const busyQuestions = new Set();
  const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
  const authorized = req => {
    const b = Buffer.from(req.headers.authorization?.replace(/^Bearer /,'') || '');
    const a = Buffer.from(token);
    return b.length === a.length && timingSafeEqual(a,b);
  };
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('需要 JSON 请求'),{status:415});
    let text = '';
    for await (const chunk of req) { text += chunk; if(Buffer.byteLength(text) > 256000) throw Object.assign(new Error('请求过大'),{status:413}); }
    try { return JSON.parse(text); } catch { throw Object.assign(new Error('JSON 格式错误'),{status:400}); }
  }
  const assets = { '/':['public/index.html','text/html'], '/app.js':['public/app.js','text/javascript'], '/styles.css':['public/styles.css','text/css'], '/demo':['public/demo.html','text/html'], '/demo.js':['public/demo.js','text/javascript'] };
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      const address = `127.0.0.1:${server.address().port}`;
      if(req.headers.host !== address) return json(res,403,{error:'拒绝此主机名'});
      const origin = req.headers.origin;
      if (origin && origin !== `http://${address}` && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return json(res,403,{error:'拒绝跨站请求'});
      if(origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
      if(req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods','GET, POST'); res.writeHead(204); return res.end(); }
      const url = new URL(req.url,`http://${address}`);
      if(url.pathname === '/api/bootstrap' && req.method === 'GET') {
        if(origin && origin !== `http://${address}` || req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) return json(res,403,{error:'请从本机看板获取配对码'});
        return json(res,200,{ token, aiConfigured:!!apiKey, model, version:'0.1.1' });
      }
      if(url.pathname.startsWith('/api/')) {
        if(!authorized(req)) return json(res,401,{error:'配对码不正确，请从看板重新复制'});
        if(url.pathname === '/api/state' && req.method === 'GET') return json(res,200,state);
        if(url.pathname === '/api/export' && req.method === 'GET') { res.setHeader('Content-Disposition','attachment; filename="study-data.json"'); return json(res,200,state); }
        if(req.method !== 'POST') return json(res,404,{error:'接口不存在'});
        const input = await body(req);
        if(url.pathname === '/api/events') { ingest(state,input); await persist(); return json(res,200,{ok:true}); }
        if(url.pathname === '/api/review') {
          const q = state.questions[trim(input.id)];
          if(!q) return json(res,404,{error:'题目不存在'});
          q.reviewed = input.reviewed === true; await persist(); return json(res,200,{ok:true});
        }
        if(url.pathname === '/api/draft') {
          const q = state.questions[trim(input.id)];
          if(!q) return json(res,404,{error:'题目不存在'});
          if(input.consent !== true) return json(res,400,{error:'请先确认发送题目给 AI'});
          if(busyQuestions.size >= 2 || busyQuestions.has(q.id)) return json(res,429,{error:'草稿正在生成，请稍后再试'});
          busyQuestions.add(q.id);
          try { q.draft = await draftAnswer({ text:q.text, apiKey, model, fetchImpl }); q.draftedAt = new Date().toISOString(); await persist(); return json(res,200,{draft:q.draft}); }
          finally { busyQuestions.delete(q.id); }
        }
        if(url.pathname === '/api/clear') {
          if(input.confirm !== '清空本地记录') return json(res,400,{error:'清空确认文字不匹配'});
          if(busyQuestions.size) return json(res,409,{error:'请等待 AI 请求结束后再清空'});
          state = emptyState(); await persist(); return json(res,200,{ok:true});
        }
        return json(res,404,{error:'接口不存在'});
      }
      if(url.pathname === '/demo.wav' && req.method === 'GET') { res.setHeader('Content-Type','audio/wav'); return res.end(demoWav()); }
      const asset = assets[url.pathname];
      if(!asset || req.method !== 'GET') return json(res,404,{error:'页面不存在'});
      res.setHeader('Content-Type',asset[1] + (asset[1].startsWith('text/') ? '; charset=utf-8' : ''));
      res.end(await readFile(path.join(root,asset[0])));
    } catch(error) { if(!res.headersSent) json(res,error.status || 400,{error:error.status ? error.message : '请求处理失败，请检查输入或本地数据目录'}); else res.end(); }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  return { server, token, url:`http://127.0.0.1:${server.address().port}`, close: async () => { await writeQueue; await new Promise(resolve => server.close(resolve)); } };
}
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await loadEnv(); const app = await createApp(); console.log(`学习助手已启动：${app.url}\n用浏览器打开以上地址；按 Ctrl+C 停止。数据仅保存在本机 data 文件夹。`); }
  catch(error) { console.error(error.code === 'EADDRINUSE' ? '18765 端口被占用。请先打开 http://127.0.0.1:18765 检查看板，或停止占用此端口的程序。' : `启动失败：${error.message}`); process.exitCode = 1; }
}
