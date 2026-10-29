const $ = id => document.getElementById(id);
let token = '', state = {sections:{},questions:{}}, fingerprint = '', polling = false;
const pending = new Set();
const labels = {observed:'已发现'};
function el(tag,className,text) { const e = document.createElement(tag); if(className) e.className = className; if(text !== undefined) e.textContent = text; return e; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true,4000); }
async function api(path,input) {
  const response = await fetch(path,{headers:{Authorization:`Bearer ${token}`, ...(input ? {'Content-Type':'application/json'}:{})},...(input ? {method:'POST',body:JSON.stringify(input)}:{})});
  const data = await response.json(); if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
}
function empty(title,text) { const e = el('div','empty'); e.append(el('h3','',title),el('p','',text)); return e; }
function metric(id,value,unit) { $(id).replaceChildren(document.createTextNode(String(value) + ' '),el('small','',unit)); }
function renderCourses() {
  const search = $('search').value.trim().toLowerCase();
  const all = Object.values(state.sections);
  const grouped = new Map();
  for(const s of all) {
    if(search && !`${s.courseTitle} ${s.title}`.toLowerCase().includes(search)) continue;
    if(!grouped.has(s.courseId)) grouped.set(s.courseId,[]);
    grouped.get(s.courseId).push(s);
  }
  $('courses').replaceChildren();
  if(!grouped.size) {
    const e = empty(search ? '没有找到相关课程' : '从你打开的第一节课开始',search ? '换一个课程名或章节名试试。' : '连接扩展后，进入学习通课程并点击「开始」，课程与视频记录会自动出现在这里。');
    if(!search) { const a = el('a','','查看连接步骤 →'); a.href = '#setup'; e.append(a); }
    $('courses').append(e); return;
  }
  for(const sections of grouped.values()) {
    const card = el('article','course'), top = el('div','course-top'), title = el('div');
    title.append(el('h3','',sections[0].courseTitle),el('small','',`${sections.length} 个已访问章节`));
    top.append(el('span','course-icon','▤'),title,el('span','course-status','本机记录')); card.append(top);
    for(const s of sections.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const row = el('div','section-row'), heading = el('div','section-title');
      const a = el(s.url ? 'a':'span','',s.title);
      if(s.url) { a.href = s.url; a.target = '_blank'; a.rel = 'noreferrer'; }
      heading.append(a); row.append(heading);
      const videos = Object.values(s.videos), duration = videos.reduce((n,v) => n+v.duration,0), position = videos.reduce((n,v) => n+Math.min(v.position,v.duration || v.position),0);
      if(duration) { const progress = el('progress','progress'); progress.max = duration; progress.value = position; progress.setAttribute('aria-label','已观察的视频位置'); row.append(progress); }
      const meta = el('div','section-meta');
      meta.append(el('span','',labels[s.status] || s.status),el('span','',duration ? `视频位置 ${Math.floor(position/60)} / ${Math.ceil(duration/60)} 分钟` : '未观察到视频时长')); row.append(meta); card.append(row);
    }
    $('courses').append(card);
  }
}
function renderQuestions() {
  const list = Object.values(state.questions).sort((a,b) => b.detectedAt.localeCompare(a.detectedAt)).filter(q => !$('pendingOnly').checked || !q.reviewed);
  $('questionList').replaceChildren();
  if(!list.length) { $('questionList').append(empty('暂时没有待处理题目','遇到章节题时，题目文字会整理到这里；图片题请结合原页面查看。')); return; }
  for(const q of list) {
    const section = state.sections[q.sectionKey];
    const card = el('article','question');
    card.append(el('div','question-context',`${section?.courseTitle || '课程'} / ${section?.title || '章节'} · ${q.reviewed ? '已核对':'待核对'}`),el('pre','',q.text));
    if(q.draft) { card.append(el('p','question-context','AI 学习草稿 · 请结合教材核对'),el('div','draft',q.draft)); }
    const consent = el('label','question-consent'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    consent.append(checkbox,document.createTextNode('我已检查题干，允许将该题文字发送给 OpenAI 生成草稿')); card.append(consent);
    const actions = el('div','question-actions'), generate = el('button','button',pending.has(q.id) ? '正在生成…' : q.draft ? '重新生成草稿':'生成学习草稿');
    generate.disabled = pending.has(q.id);
    generate.addEventListener('click',async () => {
      if(!checkbox.checked) { toast('请先勾选题目发送确认'); return; }
      pending.add(q.id); generate.disabled = true; generate.textContent = '正在生成…';
      try { await api('/api/draft',{id:q.id,consent:true}); toast('草稿已生成，请核对'); fingerprint = ''; }
      catch(e) { toast(e.message); }
      finally { pending.delete(q.id); fingerprint = ''; await refresh(); }
    });
    const review = el('button','button secondary',q.reviewed ? '设为待核对':'标记已核对');
    review.addEventListener('click',async () => { try { await api('/api/review',{id:q.id,reviewed:!q.reviewed}); fingerprint = ''; await refresh(); } catch(e) { toast(e.message); } });
    actions.append(generate,review);
    if(q.draft) { const copy = el('button','text-button','复制草稿'); copy.addEventListener('click',async () => { try { await navigator.clipboard.writeText(q.draft); toast('草稿已复制'); } catch { toast('复制失败，请手动选择草稿文字复制'); } }); actions.append(copy); }
    card.append(actions); $('questionList').append(card);
  }
}
function render() {
  const sections = Object.values(state.sections), questions = Object.values(state.questions);
  const count = new Set(sections.map(s => s.courseId)).size;
  metric('courseCount',count,'门'); metric('sectionCount',sections.length,'节'); metric('watchTime',Math.floor(sections.flatMap(s => Object.values(s.videos)).reduce((n,v) => n+v.watchedSeconds,0)/60),'分钟');
  const outstanding = questions.filter(q => !q.reviewed).length;
  metric('pendingCount',outstanding,'道'); $('navQuestions').textContent = outstanding; $('courseBadge').textContent = count;
  renderCourses(); renderQuestions();
}
async function refresh() {
  if(polling || !token) return;
  polling = true;
  try {
    state = await api('/api/state');
    $('error').hidden = true;
    const online = state.lastExtensionAt && Date.now() - new Date(state.lastExtensionAt).getTime() < 25000;
    $('connection').textContent = online ? '扩展已连接 · 正在同步' : state.lastExtensionAt ? '扩展暂未同步' : '等待扩展连接';
    $('connection').classList.toggle('online',!!online);
    const next = JSON.stringify(state);
    if(next !== fingerprint) {
      // 心跳不重建题目表单，保留用户正在勾选的发送确认。
      const qChanged = !fingerprint || JSON.stringify(state.questions) !== refresh.questions;
      const activeConsent = [...$('questionList').querySelectorAll('input')].some(input => input.checked);
      if(qChanged || !activeConsent) render(); else { renderCourses(); }
      refresh.questions = JSON.stringify(state.questions); fingerprint = next;
    }
  } catch(e) { $('error').textContent = `本地服务暂不可用：${e.message}`; $('error').hidden = false; $('connection').textContent = '连接已断开'; $('connection').classList.remove('online'); }
  finally { polling = false; }
}
$('search').addEventListener('input',renderCourses);
$('pendingOnly').addEventListener('change',renderQuestions);
$('copyToken').addEventListener('click',async () => { try { await navigator.clipboard.writeText(token); toast('配对码已复制，请粘贴到扩展'); } catch { window.prompt('请手动复制本机配对码',token); } });
$('export').addEventListener('click',async () => { try { const data = await api('/api/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const a = el('a'); a.href = url; a.download = 'study-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); } catch(e) { toast(e.message); } });
$('clear').addEventListener('click',async () => { if(window.prompt('此操作会清空本机课程、题目和草稿。建议先导出。\n确认时输入：清空本地记录') !== '清空本地记录') return; try { await api('/api/clear',{confirm:'清空本地记录'}); fingerprint = ''; await refresh(); toast('本地记录已清空。运行中的扩展会重新产生记录。'); } catch(e) { toast(e.message); } });
$('today').textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
void (async () => { try { const r = await fetch('/api/bootstrap'); if(!r.ok) throw new Error('配对信息读取失败'); const config = await r.json(); token = config.token; $('aiStatus').textContent = config.aiConfigured ? `AI 已配置 · ${config.model}` : 'AI 未配置 · 可先使用播放和记录功能'; await refresh(); } catch(e) { $('error').textContent = e.message; $('error').hidden = false; } })();
setInterval(() => { if(!document.hidden) void refresh(); },4000);
