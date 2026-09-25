const frame = document.getElementById('game-frame');
const loading = document.getElementById('demo-loading');
const error = document.getElementById('demo-error');
let ready = false;
let lastVisible = null;
let failureTimer;

function reportVisibility(force = false) {
  const box = frame.getBoundingClientRect();
  const visible = !document.hidden && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  if (force || visible !== lastVisible) {
    lastVisible = visible;
    frame.contentWindow?.postMessage({ type: 'bubble:visibility', visible }, location.origin);
  }
}
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'bubble:height') {
    const height = event.data.height;
    if (Number.isFinite(height) && height >= 200 && height <= 20000) frame.style.height = `${Math.ceil(height)}px`;
  } else if (event.data?.type === 'bubble:state') {
    showLevelState(event.data);
  } else if (event.data?.type === 'bubble:ready') {
    ready = true;
    clearTimeout(failureTimer);
    loading.hidden = true;
    error.hidden = true;
    reportVisibility(true);
  }
});
new IntersectionObserver(() => reportVisibility(), { threshold: 0 }).observe(frame);
window.addEventListener('scroll', () => reportVisibility(), { passive: true });
window.addEventListener('resize', () => reportVisibility());
document.addEventListener('visibilitychange', () => reportVisibility(true));
frame.addEventListener('load', () => reportVisibility(true));
function loadGame() {
  ready = false;
  loading.hidden = false;
  error.hidden = true;
  lastVisible = null;
  clearTimeout(failureTimer);
  frame.src = frame.dataset.src;
  failureTimer = setTimeout(() => {
    if (!ready) { loading.hidden = true; error.hidden = false; }
  }, 12000);
}
document.getElementById('retry-demo').addEventListener('click', loadGame);
// Level cards: switch the embedded game to that level and bring it into view; without JS the link opens /play/.
for (const link of document.querySelectorAll('.level-play')) link.addEventListener('click', (event) => {
  event.preventDefault();
  const level = link.dataset.level;
  frame.dataset.src = `play/?embed=1&level=${level}`;
  if (ready) frame.contentWindow.postMessage({ type: 'bubble:level', level }, location.origin);
  else loadGame();
  document.getElementById('demo').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

// Level cards mirror the embedded game: the open level is highlighted, levels won here get a check.
// Won levels are remembered per viewer; storage may be unavailable, which only loses the checks.
const PASSED_KEY = 'bubble-workshop:passed-levels';
const levelCards = new Map([...document.querySelectorAll('.level-play')].map((link) => [link.dataset.level, link.closest('li')]));
const passed = new Set();
try { for (const id of JSON.parse(localStorage.getItem(PASSED_KEY) || '[]')) if (levelCards.has(id)) passed.add(id); } catch {}
function paintLevels(current) {
  for (const [id, card] of levelCards) {
    const isCurrent = id === current, isPassed = passed.has(id);
    card.classList.toggle('is-current', isCurrent);
    card.classList.toggle('is-passed', isPassed);
    card.querySelector('.level-status').textContent = isCurrent ? 'Сейчас в игре' : isPassed ? 'Пройден' : '';
    const link = card.querySelector('.level-play');
    link.dataset.label ??= link.getAttribute('aria-label');
    const notes = [isCurrent && 'сейчас в игре', isPassed && 'пройден'].filter(Boolean);
    link.setAttribute('aria-label', notes.length ? `${link.dataset.label} (${notes.join(', ')})` : link.dataset.label);
    if (isCurrent) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
  }
}
function showLevelState({ level, won }) {
  if (typeof level !== 'string') return;
  if (won === true && levelCards.has(level) && !passed.has(level)) {
    passed.add(level);
    try { localStorage.setItem(PASSED_KEY, JSON.stringify([...passed])); } catch {}
  }
  paintLevels(level);
}
paintLevels(null);
loadGame();

// Gentle scroll reveal; content stays visible without JS or with reduced motion.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const targets = document.querySelectorAll('.section > h2, .section > .section-copy, .goal > *, .steps > article, .decision > *, .level-path > li, .product-story, .roadmap > article, .final-cta-inner');
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((el, i) => { el.classList.add('reveal'); el.style.transitionDelay = `${(i % 5) * 60}ms`; reveal.observe(el); });
  document.documentElement.classList.add('reveal-ready');
}

// Goal order: jars drop into their boxes one by one until the order is complete, then it starts over.
// The markup shows the finished order, which stays as is without JS or with reduced motion.
const orderScene = document.querySelector('.order-scene');
if (orderScene && !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const boxes = [...orderScene.querySelectorAll('.order-boxes li')];
  const doneLabel = orderScene.querySelector('.order-done');
  let delivered = 0;
  let onScreen = false;
  let timer;
  const setDelivered = (n) => {
    delivered = n;
    orderScene.style.setProperty('--done', n);
    doneLabel.textContent = n;
  };
  const reset = () => {
    setDelivered(0);
    orderScene.classList.remove('is-complete', 'is-resetting');
    for (const box of boxes) box.classList.remove('is-in', 'is-packed');
  };
  const schedule = (fn, ms) => { clearTimeout(timer); timer = setTimeout(() => { if (onScreen && !document.hidden) fn(); }, ms); };
  const step = () => {
    if (delivered === boxes.length) {
      orderScene.classList.add('is-resetting');
      return schedule(() => { reset(); schedule(step, 700); }, 400);
    }
    const box = boxes[delivered];
    box.classList.add('is-in');
    schedule(() => {
      box.classList.add('is-packed');
      setDelivered(delivered + 1);
      doneLabel.classList.remove('is-bumped');
      void doneLabel.offsetWidth;
      doneLabel.classList.add('is-bumped');
      if (delivered === boxes.length) { orderScene.classList.add('is-complete'); schedule(step, 2600); }
      else schedule(step, 750);
    }, 520);
  };
  const resume = () => { if (onScreen && !document.hidden) schedule(step, 600); else clearTimeout(timer); };
  reset();
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; resume(); }, { threshold: 0.35 }).observe(orderScene);
  document.addEventListener('visibilitychange', resume);
}

// Scale the fixed-size game board (508×1068) to its hero column.
const boardEmbed = document.querySelector('.board-embed');
if (boardEmbed) {
  const fit = () => boardEmbed.style.setProperty('--board-scale', boardEmbed.clientWidth / 508);
  new ResizeObserver(fit).observe(boardEmbed);
  fit();
}
