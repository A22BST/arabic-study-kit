export const emptyProgress = () => ({ boxes: {}, mistakes: {}, history: [] });
export function inScope(chapters, n, cumulative) {
  return chapters.filter(c => cumulative ? c.chapter <= n : c.chapter === n);
}
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function record(progress, id, correct, card = false, now = Date.now()) {
  if (card) {
    const box = correct ? Math.min(5, (progress.boxes[id]?.box || 1) + 1) : 1;
    progress.boxes[id] = { box, due: now + [0, 0, 1, 3, 7, 14][box] * 86400000 };
  }
  if (!correct) progress.mistakes[id] = 0;
  else if (id in progress.mistakes) {
    progress.mistakes[id]++;
    if (progress.mistakes[id] >= 2) delete progress.mistakes[id];
  }
  return progress;
}
export function orderCards(cards, progress, now = Date.now(), random = Math.random) {
  return shuffle(cards, random).sort((a, b) => {
    const x = progress.boxes[a.id] || { box: 1, due: 0 };
    const y = progress.boxes[b.id] || { box: 1, due: 0 };
    return Number(x.due > now) - Number(y.due > now) || x.box - y.box;
  });
}
export function validateProgress(p) {
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!object(p) || !object(p.boxes) || !object(p.mistakes) || !Array.isArray(p.history)) return false;
  const id = s => /^ch\d{2}-[cq]\d{3}$/.test(s);
  return Object.entries(p.boxes).every(([k,v]) => id(k) && object(v) && Number.isInteger(v.box) && v.box >= 1 && v.box <= 5 && Number.isFinite(v.due) && v.due >= 0)
    && Object.entries(p.mistakes).every(([k,v]) => id(k) && (v === 0 || v === 1))
    && p.history.every(v => object(v) && Number.isInteger(v.score) && Number.isInteger(v.total) && v.total > 0 && v.score >= 0 && v.score <= v.total && Number.isFinite(v.at));
}
export function mergeProgress(a, b) {
  return { boxes: { ...a.boxes, ...b.boxes }, mistakes: { ...a.mistakes, ...b.mistakes }, history: [...a.history, ...b.history].sort((x,y) => x.at-y.at).slice(-20) };
}
