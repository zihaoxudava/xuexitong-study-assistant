(() => {
  const A = globalThis.StudyAdapter;
  let settings = {}, enabled = false, blocked = false, busy = false, generation = 0;
  let lastQuestions = '', lastBlock = '', lastContext = '', lastHeartbeat = 0;
  const observed = new Map();
  const send = async message => { try { return await chrome.runtime.sendMessage(message); } catch { enabled = false; return {}; } };
  const pause = () => { for(const video of document.querySelectorAll('video, audio')) if(!video.paused) video.pause(); };
  function apply(run) {
    const wasEnabled = enabled;
    enabled = run.enabled === true; blocked = run.blocked === true; generation++;
    if((wasEnabled && !enabled) || (enabled && blocked)) pause();
    else if(enabled) void tick();
  }
  function report(event) { return send({type:'REPORT',event:{...event, context:A.context(settings)}}); }
  async function play(video,record) {
    if(record.attempt === generation || !enabled || blocked || document.visibilityState !== 'visible' || !A.mediaVisible(video)) return;
    record.attempt = generation;
    try { await video.play(); }
    catch { await report({type:'snapshot',status:'浏览器限制自动播放，请在播放器点击播放'}); }
  }
  function sample(video,record) {
    const now = performance.now(), pos = video.currentTime;
    const wall = (now - record.lastAt) / 1000, moved = pos - record.lastPosition;
    // 只累计正常播放中实际流逝的秒数；拖动、跳转与后台暂停都不计入。
    if(enabled && !blocked && document.visibilityState === 'visible' && !video.paused && !video.seeking && wall > 0 && wall < 3 && moved > 0 && moved <= wall * Math.max(video.playbackRate,1) + 0.75) record.played += Math.min(wall,moved);
    record.lastAt = now; record.lastPosition = pos;
  }
  async function videoReport(video,record,naturalEnded = false) {
    const playedSeconds = Math.min(15,record.played); record.played = 0;
    const response = await report({type:'snapshot',videoId:record.id, mediaKind:video.tagName === 'AUDIO' ? 'audio':'video', position:video.currentTime, duration:Number.isFinite(video.duration) ? video.duration : 0, playedSeconds,naturalEnded:naturalEnded || video.ended, status:naturalEnded ? '音视频自然结束' : blocked ? '等待人工处理' : video.paused ? '音视频已暂停' : '正常播放中'});
    if(response?.blocked) { blocked = true; pause(); }
    if(response?.enabled === false) { enabled = false; pause(); }
  }
  function attach(video,index) {
    if(observed.has(video)) return;
    const params = new URLSearchParams(location.search);
    const src = video.currentSrc || video.getAttribute('src') || '';
    const source = src.startsWith('blob:') ? '' : A.cleanUrl(src);
    const id = `${location.pathname}:${params.get('objectid') || ''}:${source}:${index}`;
    const record = {id, played:0,lastAt:performance.now(),lastPosition:video.currentTime,attempt:-1};
    observed.set(video,record);
    video.addEventListener('ended',async () => { if(enabled && !blocked) { sample(video,record); await videoReport(video,record,true); } });
    video.addEventListener('seeking',() => { record.lastPosition = video.currentTime; record.lastAt = performance.now(); });
    video.addEventListener('loadedmetadata',() => { if(enabled && !blocked) void play(video,record); });
  }
  async function tick() {
    if(busy || !enabled) return;
    busy = true;
    try {
      const contextKey = JSON.stringify(A.context(settings));
      if(lastContext && contextKey !== lastContext) { lastQuestions = ''; lastBlock = ''; }
      lastContext = contextKey;
      const reason = A.detectBlock();
      const qs = A.questions();
      if(reason || qs.length) {
        blocked = true; pause();
        if(reason && reason !== lastBlock) { lastBlock = reason; await report({type:'blocked',status:reason}); }
        const signature = JSON.stringify(qs);
        if(qs.length && signature !== lastQuestions) { lastQuestions = signature; await report({type:'questions',questions:qs,status:'检测到题目，等待人工处理'}); }
      }
      const videos = [...document.querySelectorAll('video, audio')];
      videos.forEach(attach);
      for(const [video,record] of observed) {
        if(!video.isConnected) { observed.delete(video); continue; }
        sample(video,record);
        if(document.visibilityState === 'visible' && !blocked) await play(video,record);
      }
      if(Date.now() - lastHeartbeat > 5000) {
        lastHeartbeat = Date.now();
        if(!observed.size) await report({type:'snapshot',status:blocked ? '等待人工处理':'已连接，未发现可操作音视频'});
        for(const [video,record] of observed) await videoReport(video,record);
      }
    } finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if(message.type === 'GET_CONTEXT') { respond(A.context(settings)); return; }
    if(message.type === 'RUN') { lastQuestions = ''; lastBlock = ''; apply(message); respond({ok:true}); return; }
    if(message.type === 'BLOCK') { blocked = true; pause(); respond({ok:true}); return; }
    if(message.type === 'NEXT') {
      if(!enabled || blocked || document.visibilityState !== 'visible' || A.detectBlock() || A.questions().length) { respond({navigated:false}); return; }
      const next = A.next(settings);
      if(next) next.click();
      respond({navigated:!!next});
    }
  });
  document.addEventListener('visibilitychange',() => { if(enabled && document.visibilityState !== 'visible') pause(); });
  void send({type:'GET_CONFIG'}).then(config => { settings = config?.settings || {}; apply(config || {}); });
  setInterval(() => void tick(),1000);
})();
