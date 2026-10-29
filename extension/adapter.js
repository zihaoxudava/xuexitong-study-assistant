/* 页面适配层：仅操作可见 DOM 和原生音视频，不读取站点私有脚本或学习记录接口。 */
(() => {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  // 定制音频播放器可能隐藏 audio 标签本身，但提供可见的 Video.js 控件。
  const mediaVisible = e => visible(e) || e?.tagName === 'AUDIO' && visible(e.closest('.video-js, [role="region"][aria-label="音频播放器"]'));
  const text = e => e?.innerText?.trim() || '';
  const all = selector => { try { return [...document.querySelectorAll(selector)]; } catch { return []; } };
  const first = selectors => selectors.flatMap(s => all(s)).find(visible);
  const cleanUrl = value => {
    try {
      const u = new URL(value);
      const out = new URL(u.origin + u.pathname);
      for (const [key,value] of u.searchParams) if(/^(courseid|clazzid|knowledgeid|chapterid|id|objectid)$/i.test(key)) out.searchParams.set(key,value.slice(0,100));
      return out.href;
    } catch { return ''; }
  };
  function context(settings = {}) {
    const u = new URL(location.href);
    const params = new Map([...u.searchParams].map(([k,v]) => [k.toLowerCase(),v]));
    const title = text(first([settings.sectionSelector, '.posCatalog_active', '.catalog_active', '.chapterTitle', '.chapter-title', 'h1'].filter(Boolean))) || document.title;
    const courseTitle = text(first([settings.courseSelector, '.courseName', '.course-name', '.course-title'].filter(Boolean))) || document.title || '未识别课程';
    const courseId = params.get('courseid') || document.body?.dataset.courseId || courseTitle;
    const sectionId = params.get('knowledgeid') || params.get('chapterid') || document.body?.dataset.sectionId || `${u.pathname}:${title}`;
    return { courseId:courseId + ':' + (params.get('clazzid') || ''), courseTitle:courseTitle.slice(0,300), sectionId, sectionTitle:title.slice(0,300), url:cleanUrl(location.href) };
  }
  function detectBlock() {
    if(first(['input[type="password"]','#captcha','.captcha','.yidun_panel','.geetest_panel','.nc-container','[data-study-block]'])) return '登录或验证提示，请在页面处理';
    const textValue = (document.body?.innerText || '').slice(0,50000);
    if(/请完成.{0,8}(验证|人脸)|拖动.{0,12}滑块|安全验证|访问异常|操作频繁|请先登录/.test(textValue)) return '页面需要验证或重新登录';
    return '';
  }
  function questions() {
    const candidates = all('.TiMu, .questionLi, .question-item, .questionItem, .mark_table, [data-study-question]').filter(visible);
    const outer = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)));
    const result = [...new Set(outer.map(text).filter(Boolean))].slice(0,30).map(value => ({text:value.slice(0,6000)}));
    if(!result.length) {
      const exam = /\/(work|exam|test)(\/|\b)/i.test(location.pathname) || first(['.Cy_TItle', '.mark_name', '.Zy_TItle', '#workSubmit']);
      if(exam) {
        const container = first(['.mark_name','.Cy_TItle','.Zy_TItle','main']);
        result.push({text:container ? text(container).slice(0,6000) : '检测到作业或测验页面。此页未识别到完整题干，请手动复制到学习资料中核对。'});
      }
    }
    return result;
  }
  function next(settings = {}) {
    const explicit = all(settings.nextSelector || 'a#nextChapter, button#nextChapter, button#prevNextFocusNext, a.nextChapter, a[title="下一节"], a[title="下一章节"]');
    const candidates = (explicit.length ? explicit : all('a, button').filter(e => /^(下一节|下一章节|下一个视频)$/.test(text(e)))).filter(e => {
      if(!visible(e) || !['A','BUTTON'].includes(e.tagName) || e.matches(':disabled,[aria-disabled="true"]') || e.closest('form')) return false;
      const label = text(e) || e.title || e.getAttribute('aria-label') || '';
      if(!/^(下一节|下一章|下一章节|下一个视频|Next chapter)$/i.test(label.trim())) return false;
      if(e.tagName === 'BUTTON' && e.form) return false;
      if(e.tagName === 'A') {
        if(!e.href || e.getAttribute('target') === '_blank') return false;
        try {
          const u = new URL(e.href);
          if(!/^https?:$/.test(u.protocol) || u.origin !== location.origin || /\/(work|exam|test|login|passport)(\/|\b)/i.test(u.pathname)) return false;
        } catch { return false; }
      }
      return true;
    });
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : null;
  }
  globalThis.StudyAdapter = { visible, mediaVisible, cleanUrl, context, detectBlock, questions, next };
})();
