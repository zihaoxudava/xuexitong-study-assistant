const section = new URLSearchParams(location.search).get('section') === '2' ? 2 : 1;
const audioMode = new URLSearchParams(location.search).get('media') === 'audio';
if(audioMode) {
  const audio = document.createElement('audio');
  audio.controls = true; audio.preload = 'auto'; audio.src = '/demo.wav';
  document.querySelector('video').replaceWith(audio);
  document.querySelector('#nextChapter').href += '&media=audio';
}
const switchMode = document.createElement('a');
switchMode.href = audioMode ? '/demo' : '/demo?media=audio';
switchMode.textContent = audioMode ? '切换到视频测试' : '切换到音频测试';
document.querySelector('.demo-card').append(switchMode);
document.body.dataset.sectionId = 'demo-' + section;
document.querySelector('.chapter-title').textContent = section === 1 ? '第 1 节 · 建立学习节奏' : '第 2 节 · 用自己的话解释';
if(section === 2) document.querySelector('#nextChapter').remove();
document.getElementById('showQuestion').addEventListener('click',() => { const q = document.createElement('div'); q.dataset.studyQuestion = ''; q.className = 'demo-card'; q.textContent = '【演示自测】学习一个新概念后，为什么用自己的话解释它有助于理解？请给出一个例子。'; document.getElementById('overlay').replaceChildren(q); });
document.getElementById('showBlock').addEventListener('click',() => { const q = document.createElement('div'); q.dataset.studyBlock = ''; q.className = 'demo-card'; q.textContent = '演示：页面需要安全验证，请人工处理。'; document.getElementById('overlay').replaceChildren(q); });
document.getElementById('removeBlock').addEventListener('click',() => document.getElementById('overlay').replaceChildren());
