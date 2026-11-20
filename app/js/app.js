import { emptyProgress, inScope, shuffle, record, orderCards, validateProgress, mergeProgress } from './logic.js';
const $ = id => document.getElementById(id);
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { $('backup-status').textContent = 'Storage unavailable. Export progress before leaving.'; } };
const root = new URL(new URLSearchParams(location.search).get('root') || '../courses', location.href);
root.pathname = root.pathname.replace(/\/?$/, '/');
if (root.origin !== location.origin) throw new Error('Content root must be on this site.');
let course, chapters = [], progress = emptyProgress(), mode = 'cards', queue = [], pos = 0, flipped = false, answered = false, score = 0, missed = [], voice;
let prefs = read('ask:selection') || {}, loadGeneration = 0;
const key = () => `ask:v1:${course.id}`;
const selection = () => ({ mode: $('scope').value, from: Number($('from').value), to: Number($('chapter').value) });
const scope = () => inScope(chapters, selection());
const pool = type => scope().flatMap(c => c[type]);
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.onclick = action; return b; }
// Content is always inserted as text nodes. Only the documented inline markup is parsed.
export function rich(target, value = '') {
  String(value).replaceAll('->', '→').split(/(\*\*.*?\*\*)/g).forEach(part => {
    const parent = part.startsWith('**') && part.endsWith('**') ? target.appendChild(el('strong')) : target;
    const text = parent === target ? part : part.slice(2,-2);
    text.split(/([\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+)/g).forEach(run => {
      if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(run)) {
        const span = el('span', run); span.lang = 'ar'; span.dir = 'rtl'; parent.append(span);
      } else parent.append(document.createTextNode(run));
    });
  });
}
function speaker(text) {
  const runs=String(text).match(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+/g);
  if (!voice || !runs) return null;
  return button('Listen', () => {
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(runs.join(' ')); u.voice = voice; u.lang = voice.lang; speechSynthesis.speak(u);
  },'speak');
}
function textBlock(parent, text, cls) { if (!text) return; const p = el('p', undefined, cls); rich(p, text); const audio = speaker(text); if (audio) p.append(audio); parent.append(p); }
function bilingual(parent, value) {
  if (value.en) textBlock(parent, value.en);
  if (value.ar) {
    textBlock(parent, value.ar);
  }
}
function updateVoices() { const previous = voice; voice = window.speechSynthesis?.getVoices().find(v => /^ar(?:-|$)/i.test(v.lang)); if (!!previous !== !!voice && course && !answered) render(); }
if (window.speechSynthesis) { speechSynthesis.addEventListener('voiceschanged', updateVoices); updateVoices(); }
function save() { write(key(), progress); stats(); }
function stats() {
  $('mistake-count').textContent = Object.keys(progress.mistakes).length;
  $('history').textContent = progress.history.length ? 'Recent quiz scores: ' + progress.history.slice(-5).map(h => `${h.score}/${h.total}`).join(' · ') : 'Your study progress is saved on this device.';
}
function remember() { prefs = { course: course.id, ...selection() }; write('ask:selection', prefs); }
function updateScope(changed) {
  if (Number($('from').value) > Number($('chapter').value)) {
    if (changed === 'from') $('chapter').value = $('from').value;
    else $('from').value = $('chapter').value;
  }
  const range = $('scope').value === 'range';
  $('from-label').hidden = !range;
  $('chapter-label').textContent = range ? 'To' : 'Chapter';
}
function start() {
  if (!course) return;
  queue = mode === 'quiz' ? [] : orderCards(pool('cards'), progress);
  if (mode === 'mistakes') queue = orderCards([...pool('cards'), ...pool('quiz')].filter(x => x.id in progress.mistakes), progress);
  pos = 0; flipped = false; answered = false; score = 0; missed = []; render();
}
function advance() { pos++; flipped = false; answered = false; render(); }
function render() {
  const area = $('study'); area.replaceChildren(); stats();
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  if (mode === 'quiz' && !queue.length) {
    area.append(el('h2', 'Test your recall')); textBlock(area, `${pool('quiz').length} questions in this scope.`, 'subtle');
    const label = el('label', 'Questions'); const select = el('select'); select.id = 'quiz-size';
    for (const [v,t] of [['10','10'],['20','20'],['all','All']]) { const o = el('option', t); o.value = v; select.append(o); }
    label.append(select); area.append(label, button('Start quiz', () => {
      queue = shuffle(pool('quiz')).slice(0, select.value === 'all' ? undefined : Number(select.value)).map(prepareQuiz);
      if (queue.length) render(); else textBlock(area, 'No quiz questions available in this scope.');
    }, 'primary')); return;
  }
  if (!queue.length) { area.append(el('h2', mode === 'mistakes' ? 'No mistakes to review' : 'No cards available')); textBlock(area, mode === 'mistakes' ? 'Items you miss will appear here. Two consecutive correct answers clear an item.' : 'Choose another chapter or check the file messages above.'); return; }
  if (pos >= queue.length) {
    area.append(el('h2', mode === 'quiz' ? `Score: ${score} / ${queue.length}` : 'Session complete'));
    if (missed.length) { textBlock(area, 'Missed items'); const list = el('ul'); for (const item of missed) { const li = el('li'); bilingual(li,item.prompt); textBlock(li, 'Correct answer:'); bilingual(li,item.options[item.correct]); textBlock(li,item.explanation); textBlock(li,item.source,'meta'); list.append(li); } area.append(list); }
    area.append(button(mode === 'mistakes' ? 'Review remaining mistakes' : 'Start another session', start, 'primary')); return;
  }
  const item = queue[pos];
  textBlock(area, `${pos+1} / ${queue.length}${mode === 'mistakes' ? ' · Mistakes review' : ''}`, 'meta');
  const meter = el('progress'); meter.max = queue.length; meter.value = pos; meter.setAttribute('aria-label','Session progress'); area.append(meter);
  if (item.prompt) { renderQuiz(area, item.optionsShuffled ? item : prepareQuizInPlace(item)); return; }
  const counts = [1,2,3,4,5].map(n => `Box ${n}: ${pool('cards').filter(c => (progress.boxes[c.id]?.box || 1) === n).length}`).join(' · ');
  textBlock(area, counts, 'boxes');
  const face = el('div', undefined, 'card-face'); face.id = 'card'; face.tabIndex = 0; face.setAttribute('role', 'button'); face.setAttribute('aria-label', flipped ? 'Card back. Tap to show front' : 'Card front. Tap to reveal answer');
  face.onclick = e => { if (!e.target.closest('button')) { flipped = !flipped; render(); } };
  face.onkeydown = e => { if ((e.key === ' ' || e.key === 'Enter') && e.target === face) { e.preventDefault(); flipped = !flipped; render(); $('card')?.focus(); } };
  bilingual(face, flipped ? item.back : item.front);
  if (flipped) textBlock(face, item.translit, 'translit');
  area.append(face); textBlock(area, flipped ? item.source : 'Tap the card or press Space to reveal.', 'meta');
  if (flipped) { const actions = el('div', undefined, 'actions'); for (const [name,correct] of [['Again',false],['Good',true]]) actions.append(button(name, () => { record(progress,item.id,correct,true); save(); advance(); }, correct ? 'good' : 'again')); area.append(actions); }
}
function prepareQuiz(item) { return { ...item, optionsShuffled: shuffle(item.options.map((value,index) => ({ value, correct: index === item.correct }))) }; }
function prepareQuizInPlace(item) { item.optionsShuffled = prepareQuiz(item).optionsShuffled; return item; }
function renderQuiz(area,item) {
  const prompt = el('div', undefined, 'quiz-prompt'); bilingual(prompt,item.prompt); area.append(prompt);
  const options = el('div', undefined, 'options');
  item.optionsShuffled.forEach((option,index) => {
    const b = button('', () => {
      if (answered) return; answered = true; record(progress,item.id,option.correct); if (option.correct) score++; else missed.push(item);
      if (mode === 'quiz' && pos === queue.length-1) progress.history = [...progress.history,{score,total:queue.length,at:Date.now()}].slice(-20);
      save();
      [...options.querySelectorAll('.option')].forEach((node,i) => { node.disabled = true; if (item.optionsShuffled[i].correct) node.classList.add('correct'); else if (i === index) node.classList.add('incorrect'); });
      const feedback = el('div',undefined,'feedback'); feedback.setAttribute('role','status'); textBlock(feedback,option.correct ? 'Correct' : 'Incorrect'); textBlock(feedback,item.explanation); textBlock(feedback,item.source,'meta'); area.append(feedback,button('Next',advance,'primary'));
    },'option');
    // Options contain text spans only, avoiding nested interactive controls.
    if (option.value.en) rich(b,option.value.en);
    if (option.value.ar) { b.append(el('br')); rich(b,option.value.ar); }
    const row=el('div'); row.append(b); const audio=speaker([option.value.en,option.value.ar].filter(Boolean).join(' ')); if(audio) row.append(audio); options.append(row);
  }); area.append(options);
}
async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
function error(file,e) { textBlock($('errors'),`Could not load ${file}: ${e.message}. Other available content remains usable.`); }
async function loadCourse(id) {
  const generation = ++loadGeneration;
  $('loading').textContent = 'Loading your course…'; $('errors').replaceChildren(); $('study').replaceChildren();
  try {
    const metadata = await json(new URL(`${id}/course.json`,root));
    if (generation !== loadGeneration) return;
    course = metadata;
    if (course.id !== id || !Array.isArray(course.chapters)) throw new Error('Invalid course metadata');
    const stored = read(key()); progress = validateProgress(stored) ? stored : emptyProgress();
    const results = await Promise.all(course.chapters.map(async c => {
      const file = `${id}/ch${String(c.n).padStart(2,'0')}.json`;
      try { const data = await json(new URL(file,root)); if (!validChapter(data,c.n)) throw new Error('Invalid chapter data'); return data; } catch(e) { if (generation === loadGeneration) error(file,e); return null; }
    }));
    if (generation !== loadGeneration) return;
    chapters = results.filter(Boolean);
    for (const id of ['from', 'chapter']) {
      $(id).replaceChildren();
      for (const c of course.chapters) { const o = el('option',`${c.n}. ${c.title}`); o.value = c.n; $(id).append(o); }
      const saved = id === 'from' ? (prefs.from ?? 1) : (prefs.to ?? prefs.chapter);
      if ([...$(id).options].some(o => o.value === String(saved))) $(id).value = saved;
    }
    $('scope').value = prefs.mode === 'range' || prefs.scope === 'cumulative' ? 'range' : 'single';
    updateScope();
    $('course-title').replaceChildren(); rich($('course-title'),course.title); $('loading').textContent = ''; remember(); start();
  } catch(e) { if (generation === loadGeneration) { error(`${id}/course.json`,e); $('loading').textContent = 'Choose an available course to continue.'; } }
}
function validChapter(data,n) {
  const bilingual = value => value && typeof value === 'object' && ['ar','en'].every(k => value[k] === undefined || typeof value[k] === 'string') && Boolean(value.ar || value.en);
  const item = (x,kind) => x && new RegExp(`^ch${String(n).padStart(2,'0')}-${kind}\\d{3}$`).test(x.id) && typeof x.source === 'string';
  return data && data.chapter === n && Array.isArray(data.cards) && Array.isArray(data.quiz)
    && data.cards.every(x => item(x,'c') && bilingual(x.front) && bilingual(x.back))
    && data.quiz.every(x => item(x,'q') && bilingual(x.prompt) && Array.isArray(x.options) && x.options.length >= 3 && x.options.every(bilingual) && Number.isInteger(x.correct) && x.correct >= 0 && x.correct < x.options.length && typeof x.explanation === 'string');
}
for (const id of ['scope', 'from', 'chapter']) $(id).onchange = () => { updateScope(id); remember(); start(); };
$('course').onchange = () => loadCourse($('course').value);
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; start(); });
function theme(value) { if (value) document.documentElement.dataset.theme = value; const dark = value ? value === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; $('theme').textContent = dark ? 'Light mode' : 'Dark mode'; $('theme').setAttribute('aria-pressed',String(dark)); }
theme(read('ask:theme'));
$('theme').onclick = () => { const next = $('theme').getAttribute('aria-pressed') === 'true' ? 'light' : 'dark'; theme(next); write('ask:theme',next); };
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => theme(read('ask:theme')));
$('export').onclick = () => {
  if (!course) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({version:1,courseId:course.id,progress},null,2)],{type:'application/json'}));
  const a = el('a'); a.href = url; a.download = `arabic-study-${course.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};
$('import').onchange = async () => {
  try {
    if (!course) throw new Error('Load a course first.');
    const file = $('import').files[0]; if (!file) return; if (file.size > 5000000) throw new Error('Backup is too large.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || data.courseId !== course.id || !validateProgress(data.progress)) throw new Error('Invalid backup or different course.');
    const replace = $('import-method').value === 'replace';
    if (!confirm(`${replace ? 'Replace' : 'Merge'} progress for ${course.title}?`)) return;
    progress = replace ? data.progress : mergeProgress(progress,data.progress); save(); start(); $('backup-status').textContent = 'Progress imported.';
  } catch(e) { $('backup-status').textContent = `Import failed: ${e.message}`; }
  finally { $('import').value = ''; }
};
async function offline() {
  if (!('serviceWorker' in navigator)) { $('offline-status').textContent = 'Offline installation is unavailable in this browser.'; return; }
  try {
    // Refresh an already controlled page once when a new cache-first shell takes over.
    const controlled = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controlled && !reloading) { reloading = true; location.reload(); }
    });
    await navigator.serviceWorker.register('sw.js');
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    const channel = new MessageChannel();
    channel.port1.onmessage = ({data}) => { $('offline-status').textContent = data.errors?.length ? `Offline copy incomplete: ${data.errors.join(', ')}. Reload when online to retry.` : 'Ready offline. App and course content are saved.'; };
    $('offline-status').textContent = 'Saving app and course content for offline use…';
    worker.postMessage({type:'CACHE_CONTENT',root:root.href},[channel.port2]);
  } catch(e) { $('offline-status').textContent = `Offline setup failed: ${e.message}`; }
}
try {
  const index = await json(new URL('index.json',root));
  if (!Array.isArray(index.courses) || !index.courses.length || index.courses.some(id => !/^[a-z0-9-]+$/.test(id))) throw new Error('Invalid course index');
  for (const id of index.courses) { const o = el('option',id.replaceAll('-',' ')); o.value = id; $('course').append(o); }
  $('course-label').hidden = index.courses.length === 1;
  $('course').value = index.courses.includes(prefs.course) ? prefs.course : index.courses[0];
  await loadCourse($('course').value);
  // Populate friendly course titles without making one broken course block another.
  await Promise.all([...$('course').options].map(async o => { try { const c = await json(new URL(`${o.value}/course.json`,root)); o.textContent = c.title; } catch {} }));
} catch(e) { error(new URL('index.json',root).pathname,e); $('loading').textContent = 'Content unavailable. Reload when online to try again.'; }
offline();
