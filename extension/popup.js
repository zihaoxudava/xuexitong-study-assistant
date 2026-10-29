const $ = id => document.getElementById(id);
let tabId;
async function message(value) { const r = await chrome.runtime.sendMessage(value); if(r?.error) throw new Error(r.error); return r; }
function action(id,fn) { $(id).addEventListener('click',async () => { $(id).disabled = true; $('message').textContent = ''; try { await fn(); } catch(e) { $('message').textContent = e.message; } finally { $(id).disabled = false; } }); }
async function save() {
  const settings = {autoNext:$('autoNext').checked};
  for(const key of ['courseSelector','sectionSelector','nextSelector']) { const v = $(key).value.trim(); if(v) { try { document.querySelector(v); } catch { throw new Error('选择器格式无效：' + key); } } settings[key] = v; }
  await message({type:'SAVE_SETTINGS',settings});
}
async function refresh() {
  const state = await message({type:'POPUP_STATE',tabId});
  $('status').textContent = state.run.status;
  $('sync').textContent = `${state.token ? '已配对' : '未配对'} · 待同步 ${state.outbox?.length || 0} 条${state.syncError ? ' · ' + state.syncError : ''}`;
  return state;
}
action('pair',async () => { await message({type:'PAIR',token:$('token').value}); $('token').value = ''; await refresh(); $('message').textContent = '已连接本地看板'; });
action('save',async () => { await save(); $('message').textContent = '设置已保存，页面适配设置需刷新课程页'; });
action('start',async () => { await save(); await message({type:'CONTROL',tabId,enabled:true}); await refresh(); });
action('pause',async () => { await message({type:'CONTROL',tabId,enabled:false}); await refresh(); });
void (async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); tabId = tab?.id;
    const state = await refresh();
    $('autoNext').checked = state.settings.autoNext;
    for(const key of ['courseSelector','sectionSelector','nextSelector']) $(key).value = state.settings[key];
  } catch(e) { $('message').textContent = e.message; }
})();
