import { createHash } from 'node:crypto';

export const emptyState = () => ({ version: 1, sections: {}, questions: {}, recentEventIds:[], lastExtensionAt: null });
export const trim = (s, n = 300) => typeof s === 'string' ? s.trim().slice(0, n) : '';
export const digest = s => createHash('sha256').update(s).digest('hex').slice(0, 24);
export const number = (v, max = 86400) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
export function safeUrl(value) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || !/(^|\.)(chaoxing\.com|xuexitong\.com)$/.test(u.hostname)) return '';
    const clean = new URL(u.origin + u.pathname);
    for (const [k,v] of u.searchParams) if (/^(courseid|clazzid|knowledgeid|chapterid|id)$/i.test(k)) clean.searchParams.set(k, v.slice(0,100));
    return clean.href;
  } catch { return ''; }
}
export function ingest(state, event, now = new Date().toISOString()) {
  if (!event || !['snapshot','questions','blocked'].includes(event.type)) throw new Error('无效事件');
  const eventId = trim(event.eventId,80);
  state.recentEventIds ||= [];
  if(eventId && state.recentEventIds.includes(eventId)) return null;
  const courseId = trim(event.courseId) || 'unknown';
  const sectionId = trim(event.sectionId) || 'unknown';
  const key = digest(`${courseId}\n${sectionId}`);
  let section = state.sections[key];
  if (!section) {
    if (Object.keys(state.sections).length >= 2000) throw new Error('本地章节记录已达上限，请导出后清空');
    section = state.sections[key] = { id:key, courseId, sectionId, courseTitle:trim(event.courseTitle) || '未识别课程', title:trim(event.sectionTitle) || '未识别章节', url:safeUrl(event.url), videos:{}, status:'observed', updatedAt:now };
  }
  if (trim(event.courseTitle)) section.courseTitle = trim(event.courseTitle);
  if (trim(event.sectionTitle)) section.title = trim(event.sectionTitle);
  if (safeUrl(event.url)) section.url = safeUrl(event.url);
  section.updatedAt = now;
  section.status = trim(event.status, 80) || section.status;
  state.lastExtensionAt = now;
  if (event.type === 'snapshot' && trim(event.videoId)) {
    const vid = digest(trim(event.videoId, 1000));
    if (!section.videos[vid] && Object.keys(section.videos).length >= 100) throw new Error('单章节视频数超出上限');
    const video = section.videos[vid] ||= { position:0, duration:0, watchedSeconds:0, ended:false };
    video.kind = event.mediaKind === 'audio' ? 'audio':'video';
    video.position = number(event.position);
    video.duration = number(event.duration);
    video.watchedSeconds = Math.round((video.watchedSeconds + number(event.playedSeconds, 15)) * 100) / 100;
    video.ended ||= event.naturalEnded === true;
    video.updatedAt = now;
  }
  if (event.type === 'questions') {
    if (!Array.isArray(event.questions)) throw new Error('题目格式错误');
    for (const raw of event.questions.slice(0, 30)) {
      const text = trim(raw.text, 6000);
      if (!text) continue;
      const id = digest(`${key}\n${text}`);
      if (!state.questions[id] && Object.keys(state.questions).length >= 1000) break;
      const prior = state.questions[id];
      state.questions[id] = { id, sectionKey:key, text, detectedAt:prior?.detectedAt || now, reviewed:prior?.reviewed || false, draft:prior?.draft || '' };
    }
  }
  if(eventId) { state.recentEventIds.push(eventId); state.recentEventIds = state.recentEventIds.slice(-1000); }
  return section;
}
