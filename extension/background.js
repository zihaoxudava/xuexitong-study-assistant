const LOCAL = 'http://127.0.0.1:18765';
const defaults = { autoNext:false, courseSelector:'', sectionSelector:'', nextSelector:'' };
const setup = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
]);
let serial = Promise.resolve();
let flushing = false;
const isCourse = value => {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && (/(^|\.)(chaoxing\.com|xuexitong\.com)$/.test(u.hostname) || u.origin === LOCAL && u.pathname === '/demo'); } catch { return false; }
};
const getTab = async id => (await chrome.storage.session.get(`tab${id}`))[`tab${id}`] || {enabled:false, blocked:false, status:'尚未启动', frames:{}};
const putTab = (id,value) => chrome.storage.session.set({[`tab${id}`]:value});
async function broadcast(tabId,message) { try { await chrome.tabs.sendMessage(tabId,message); } catch {} }
async function request(path,input,token) {
  const response = await fetch(LOCAL + path, {method:input ? 'POST':'GET', signal:AbortSignal.timeout(8000), headers:{Authorization:`Bearer ${token}`, ...(input ? {'Content-Type':'application/json'} : {})}, ...(input ? {body:JSON.stringify(input)} : {})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function enqueue(event) {
  const {outbox = []} = await chrome.storage.local.get('outbox');
  outbox.push({...event, eventId:crypto.randomUUID()});
  const dropped = outbox.length > 200;
  await chrome.storage.local.set({outbox:outbox.slice(-200), ...(dropped ? {syncError:'离线记录超过 200 条，最早记录已丢弃'} : {})});
}
async function flush() {
  if(flushing) return;
  flushing = true;
  try {
    const {token,outbox = []} = await chrome.storage.local.get(['token','outbox']);
    if(!token || !outbox.length) return;
    for(const event of outbox.slice(0,20)) {
      await request('/api/events',event,token);
      const remove = serial.then(async () => {
        const {outbox:latest = []} = await chrome.storage.local.get('outbox');
        await chrome.storage.local.set({outbox:latest.filter(e => e.eventId !== event.eventId), lastSync:Date.now(), syncError:''});
      });
      serial = remove.catch(() => {});
      await remove;
    }
  } catch(error) { await chrome.storage.local.set({syncError:`同步失败：${error.message}`}); }
  finally { flushing = false; }
}
async function handle(message,sender) {
  await setup;
  const trusted = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''));
  if(trusted) {
    if(message.type === 'POPUP_STATE') {
      const local = await chrome.storage.local.get(['settings','token','lastSync','syncError','outbox']);
      return {...local, settings:{...defaults,...local.settings}, run:await getTab(message.tabId)};
    }
    if(message.type === 'PAIR') {
      const token = String(message.token || '').trim();
      if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('请粘贴完整的 64 位配对码');
      await request('/api/state',null,token);
      await chrome.storage.local.set({token,syncError:''});
      setTimeout(() => void flush(),0); return {ok:true};
    }
    if(message.type === 'SAVE_SETTINGS') {
      const s = message.settings || {};
      const settings = {...defaults, autoNext:s.autoNext === true};
      for(const field of ['courseSelector','sectionSelector','nextSelector']) settings[field] = String(s[field] || '').slice(0,200);
      await chrome.storage.local.set({settings}); return {ok:true};
    }
    if(message.type === 'CONTROL') {
      const tab = await chrome.tabs.get(message.tabId);
      if(!isCourse(tab.url)) throw new Error('请先打开学习通课程页面或本地演示页');
      const old = await getTab(tab.id);
      const run = {enabled:message.enabled === true, blocked:false, status:message.enabled ? '辅助已开启':'已暂停', frames:{}, session:crypto.randomUUID()};
      await putTab(tab.id,run);
      await broadcast(tab.id,{type:'RUN',...run});
      return {ok:true,wasEnabled:old.enabled};
    }
    throw new Error('未知操作');
  }
  if(!sender.tab || !isCourse(sender.tab.url)) throw new Error('页面不在支持范围');
  const tabId = sender.tab.id;
  const run = await getTab(tabId);
  const {settings = {}} = await chrome.storage.local.get('settings');
  if(message.type === 'GET_CONFIG') return {settings:{...defaults,...settings}, ...run};
  if(message.type !== 'REPORT') throw new Error('未知页面消息');
  if(!run.enabled) return {enabled:false};
  let context = message.event?.context;
  if(sender.frameId !== 0) {
    try { context = await chrome.tabs.sendMessage(tabId,{type:'GET_CONTEXT'},{frameId:0}); } catch { return {enabled:run.enabled}; }
  }
  if(!context?.courseId || !context?.sectionId) return {enabled:run.enabled};
  const identity = `${context.courseId}\n${context.sectionId}`;
  if(run.identity !== identity) { run.frames = {}; run.identity = identity; }
  const event = {...message.event,...context};
  delete event.context;
  if(!['snapshot','questions','blocked'].includes(event.type)) throw new Error('无效事件');
  run.status = event.status || run.status;
  if(event.type === 'questions' || event.type === 'blocked') {
    run.blocked = true; run.status = event.type === 'questions' ? '检测到题目，等待人工处理' : event.status;
    await broadcast(tabId,{type:'BLOCK',reason:run.status});
  }
  if(event.videoId) run.frames[`${sender.frameId}:${event.videoId}`] = {ended:event.naturalEnded === true, at:Date.now()};
  await putTab(tabId,run);
  await enqueue(event);
  if(event.naturalEnded && settings.autoNext && !run.blocked && run.navigatedIdentity !== identity) {
    const frames = Object.values(run.frames).filter(f => Date.now() - f.at < 20000);
    if(frames.length && frames.every(f => f.ended)) {
      run.navigatedIdentity = identity;
      await putTab(tabId,run);
      const response = await chrome.tabs.sendMessage(tabId,{type:'NEXT'},{frameId:0}).catch(() => null);
      run.status = response?.navigated ? '已切换下一节' : '视频结束，请手动选择下一节';
      await putTab(tabId,run);
    }
  }
  return {enabled:run.enabled,blocked:run.blocked};
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  // 页面事件、队列写入和同步串行，避免多个 iframe 互相覆盖进度。
  const op = serial.then(() => handle(message,sender));
  serial = op.catch(() => {});
  op.then(result => { respond(result); if(message.type === 'REPORT') scheduleFlush(); },error => respond({error:error.message}));
  return true;
});
function scheduleFlush() { void flush(); }
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('sync',{periodInMinutes:1}));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('sync',{periodInMinutes:1}));
chrome.alarms.onAlarm.addListener(alarm => { if(alarm.name === 'sync') scheduleFlush(); });
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove(`tab${id}`));
