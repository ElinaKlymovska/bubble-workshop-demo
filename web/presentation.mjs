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

// Scale the fixed-size game board (508×1068) to its hero column.
const boardEmbed = document.querySelector('.board-embed');
if (boardEmbed) {
  const fit = () => boardEmbed.style.setProperty('--board-scale', boardEmbed.clientWidth / 508);
  new ResizeObserver(fit).observe(boardEmbed);
  fit();
}
