import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { emptyState, ingest, safeUrl } from '../lib/model.mjs';
import { draftAnswer } from '../lib/ai.mjs';
import { createApp } from '../server.mjs';

const event = {type:'snapshot',courseId:'course-1',sectionId:'section-1',courseTitle:'测试课程',sectionTitle:'第一节',videoId:'video-1',position:6,duration:60,playedSeconds:5};
test('只记录观察到的播放；视频位置不会转换成平台完成状态',() => {
  const s = emptyState();
  ingest(s,{...event,eventId:'first'}); ingest(s,{...event,eventId:'first'}); ingest(s,{...event,position:59,playedSeconds:0});
  const v = Object.values(Object.values(s.sections)[0].videos)[0];
  assert.equal(v.watchedSeconds,5); assert.equal(v.position,59); assert.equal(v.ended,false);
  ingest(s,{...event,naturalEnded:true}); assert.equal(v.ended,true);
});
test('过滤网址中的令牌和不受信任链接',() => {
  assert.equal(safeUrl('https://mooc1.chaoxing.com/path?courseId=1&token=secret&enc=secret'),'https://mooc1.chaoxing.com/path?courseId=1');
  assert.equal(safeUrl('https://chaoxing.com.evil.test/'), ''); assert.equal(safeUrl('javascript:alert(1)'), '');
});
test('题目重复检测保留草稿和核对状态，按章节隔离',() => {
  const s = emptyState(); ingest(s,{...event,type:'questions',questions:[{text:'为什么需要复习？'}]});
  const q = Object.values(s.questions)[0]; q.reviewed = true; q.draft = '示例';
  ingest(s,{...event,type:'questions',questions:[{text:'为什么需要复习？'}]});
  assert.equal(Object.keys(s.questions).length,1); assert.equal(q.draft,'示例'); assert.equal(Object.values(s.questions)[0].reviewed,true);
  ingest(s,{...event,sectionId:'another',type:'questions',questions:[{text:'为什么需要复习？'}]}); assert.equal(Object.keys(s.questions).length,2);
});
test('AI 仅发送本题文字、使用 Responses API，错误不泄漏密钥',async () => {
  let sent;
  const result = await draftAnswer({text:'题目内容',apiKey:'test-only',model:'test-model',fetchImpl:async (url,options) => {
    assert.equal(url,'https://api.openai.com/v1/responses'); sent = JSON.parse(options.body);
    return {ok:true,json:async () => ({output:[{content:[{type:'output_text',text:'学习草稿'}]}]})};
  }});
  assert.equal(result,'学习草稿'); assert.equal(sent.store,false); assert.match(sent.input,/题目内容/); assert.equal(sent.tools,undefined);
  await assert.rejects(draftAnswer({text:'x',apiKey:''}),/尚未配置/);
  await assert.rejects(draftAnswer({text:'x',apiKey:'sensitive',model:'x',fetchImpl:async()=>({ok:false,status:401})}),error => error.message.includes('401') && !error.message.includes('sensitive'));
});
test('本地接口的配对、跨站限制、AI 同意、持久化和清空',async () => {
  const base = process.env.TEST_TMP_DIR || tmpdir();
  const dir = await mkdtemp(path.join(base,'study-test-'));
  let app = await createApp({dataDir:dir,port:0,apiKey:''});
  const call = (route,body,auth=true,extra={}) => fetch(app.url+route,{method:body ? 'POST':'GET',headers:{...(auth ? {Authorization:`Bearer ${app.token}`} : {}),...(body ? {'Content-Type':'application/json'}:{}),...extra},...(body ? {body:JSON.stringify(body)}:{})});
  try {
    assert.equal((await call('/api/state',null,false)).status,401);
    assert.equal((await call('/api/bootstrap',null,false,{Origin:'https://evil.test'})).status,403);
    assert.equal((await call('/api/bootstrap',null,false,{'Sec-Fetch-Site':'cross-site'})).status,403);
    const badHost = await new Promise((resolve,reject) => { const req = http.get(app.url+'/api/state',{headers:{Host:'evil.test'}},res => {res.resume(); resolve(res.statusCode);}); req.on('error',reject); });
    assert.equal(badHost,403);
    assert.equal((await call('/api/bootstrap',null,false)).status,200);
    assert.equal((await call('/api/events',{...event,eventId:'integration'})).status,200);
    await call('/api/events',{...event,eventId:'integration'});
    await call('/api/events',{...event,type:'questions',questions:[{text:'测试题目'}]});
    let state = await (await call('/api/state')).json(); const q = Object.values(state.questions)[0];
    assert.equal(Object.values(Object.values(state.sections)[0].videos)[0].watchedSeconds,5);
    assert.equal((await call('/api/draft',{id:q.id})).status,400);
    assert.equal((await call('/api/draft',{id:q.id,consent:true})).status,503);
    assert.equal((await call('/api/review',{id:q.id,reviewed:true})).status,200);
    assert.equal((await call('/api/export')).status,200);
    assert.equal((await call('/../server.mjs')).status,404); assert.equal((await call('/')).status,200);
    assert.match(await readFile(path.join(dir,'state.json'),'utf8'),/测试课程/);
    const token = app.token; await app.close(); app = await createApp({dataDir:dir,port:0,apiKey:''}); assert.equal(app.token,token);
    state = await (await call('/api/state')).json(); assert.equal(Object.values(state.questions)[0].reviewed,true);
    assert.equal((await call('/api/clear',{confirm:'wrong'})).status,400);
    assert.equal((await call('/api/clear',{confirm:'清空本地记录'})).status,200);
    state = await (await call('/api/state')).json(); assert.equal(Object.keys(state.sections).length,0);
  } finally { await app.close(); await rm(dir,{recursive:true,force:true}); }
});
