import { PackingPlayback } from "./packing.mjs";
import { MotionFeed } from "./motion.mjs";
import { Session } from "./session.mjs";
import { checkpoint } from "../sim/engine.mjs";
import { CAMPAIGN, nextCampaignLevel } from "../sim/campaign-data.mjs";
import { campaignGuide } from "./campaign-guide.mjs";
import { maskGuide } from "./mask-guide.mjs";

const $ = (id) => document.getElementById(id);
// Module-relative, so the game works under any base path (dev server, GitHub Pages).
const asset = (name) => new URL(name, import.meta.url).href;
const resource = {
  oil: { name: "Масло", short: "масло", img: asset("ball-oil.png") },
  water: { name: "Вода", short: "воду", img: asset("ball-water.png") },
  wax_solid: { name: "Воск", short: "воск", img: asset("ball-wax.png") },
  wax_liquid: { name: "Жидкий воск", short: "жидкий воск", img: asset("ball-liquid-wax.png") },
  cream_warm: { name: "Тёплая смесь", short: "тёплую смесь", img: asset("ball-warm.png") },
  cream: { name: "Готовый крем", short: "крем", img: asset("jar-cream.png") },
  plant_base: { name: "Растительная основа", short: "растительную основу", img: asset("ball-plant-base.svg") },
  plant_pulp: { name: "Мякоть", short: "мякоть", img: asset("ball-pulp.png") },
  plant_juice: { name: "Сок", short: "сок", img: asset("ball-juice.png") },
  soft_pulp: { name: "Гель", short: "гель", img: asset("ball-gel.png") },
  cooled_juice: { name: "Охлаждённый экстракт", short: "охлаждённый экстракт", img: asset("ball-chilled-extract.png") },
  plant_mask: { name: "Растительная маска", short: "маску", img: asset("jar-mask.png") },
};
const roomNames = { cold: "Холод", heater: "Нагрев", mixer: "Смеситель", centrifuge: "Центрифуга" };
const roomArt = { cold: asset("machine-cooler.png"), heater: asset("machine-heater.png"), mixer: asset("machine-mixer.png"), centrifuge: asset("machine-centrifuge.png") };
const roomColors = { cold: "#5aa2e6", heater: "#f08a3c", mixer: "#3fae78", centrifuge: "#9468d6" };
const waitingText = { cold: "Ждёт смесь", heater: "Ждёт воск", mixer: "Собирает рецепт", centrifuge: "Ждёт сырьё" };
const reasons = { ENTRY_OCCUPIED: "Вход занят. Попробуй, когда шарик проедет дальше.", BELT_CAPACITY: "На конвейере 6 шариков. Дождись свободного места.", SOURCE_MISMATCH: "Этот шарик уже сменил место.", PAUSED: "Игра на паузе. Нажми «Продолжить».", LEVEL_ENDED: "Уровень завершён.", DUPLICATE_COMMAND: "Этот запуск уже учтён." };
const icon = (name, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const ball = (kind, cls = "") => `<img class="${cls}" src="${resource[kind].img}" alt="" title="${resource[kind].name}">`;
/** Dispenser button colours: highlight, face, rim shadow. */
const dispenserColors = {
  oil: ["#ffe58a", "#f2b21e", "#b57a0c"], water: ["#8fd0ff", "#2a86e0", "#1a5fa8"], wax_solid: ["#fff1b0", "#f2a93a", "#b06e12"],
  plant_base: ["#d8f5a8", "#6cbf45", "#3f8a22"], default: ["#e6d4ff", "#8a5cc7", "#5e3a96"], empty: ["#f2f3f6", "#c3c7d2", "#8c91a2"],
};
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let session, toastTimer, resultDismissed = null;
const embedded = document.documentElement.classList.contains('embedded');
let parentVisible = !embedded;
let lastClock = performance.now(), elapsed = 0;
const baseInterval = 900;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const animations = new Map();
const packing = new PackingPlayback();
const motion = new MotionFeed();
const flights = new Set();
const flyLayer = document.createElement("div");
flyLayer.className = "fly-layer";
flyLayer.setAttribute("aria-hidden", "true");
document.body.append(flyLayer);
const path = $("belt-route");
const pathLength = path.getTotalLength();
/** Scene x (viewBox units) of the packing box centre, left of the belt in the board gutter. */
const DOCK_X = -58;
const pointAt = (position) => path.getPointAtLength((((position % 16) + 16) % 16) / 16 * pathLength);

function drawPorts() {
  const returnPoint = pointAt(1);
  const returnLabel = document.querySelector('.label-return');
  returnLabel.style.left = `${returnPoint.x / 7}%`;
  returnLabel.style.top = `${returnPoint.y / 6 + 4}%`;
  returnLabel.style.right = 'auto';
  returnLabel.style.transform = 'translate(5.5cqmin,-20%)';
  const ports = [{ p: 0, color: "#8a5cc7", label: "Запуск" }, { p: 1, color: "#f2a93a", label: "Возврат в буфер" }];
  for (const [room, p] of Object.entries({ mixer: 2, heater: 6, cold: 10, centrifuge: 14 })) {
    ports.push({ p, color: roomColors[room], label: `Вход: ${roomNames[room]}` });
    ports.push({ p: p + 1, color: roomColors[room], label: `Выход: ${roomNames[room]}`, output: true });
  }
  const at = (point) => `left:${point.x / 7}%;top:${point.y / 6}%`;
  const chevrons = Array.from({ length: 16 }, (_, k) => {
    const p = pointAt(k + .5), next = pointAt(k + .55), dx = next.x - p.x, dy = next.y - p.y;
    const deg = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 180) : (dy > 0 ? 90 : 270);
    return `<i class="belt-chevron" style="${at(p)};--dir:${deg}deg"></i>`;
  });
  $("belt-marks").innerHTML = chevrons.join("") + ports.map(({ p, color, label, output }) =>
    `<i class="belt-port${output ? ' output' : ''}" style="${at(pointAt(p))};--port:${color}" title="${label}"></i>`).join("");
  const pack = pointAt(session.state.level.board.packingPosition);
  $("packing-dock").style.top = `${pack.y / 6}%`;
  // Packing spur: a short slate belt from the junction to the box, drawn under the main belt.
  const spur = `M${pack.x} ${pack.y}H${DOCK_X}`;
  $("packing-spur").innerHTML = ['belt-shadow spur', 'belt-rim spur', 'belt-band spur'].map((cls) => `<path class="${cls}" d="${spur}" vector-effect="non-scaling-stroke"/>`).join('');
  $("belt-marks").insertAdjacentHTML('beforeend', [0].map((x) => `<i class="belt-chevron spur" style="${at({ x, y: pack.y })};--dir:180deg"></i>`).join('')
    + `<i class="belt-diverter" style="${at(pack)}" title="Упаковка"></i>`);
}

/** Route the return chute from the return port to the buffer tray: straight down when the tray is below the
 *  board (phone), otherwise down under the belt and across (desktop); chevrons point toward the tray. */
let chuteKey = '';
function drawChute() {
  const panel = document.querySelector('.workshop-panel').getBoundingClientRect();
  const scene = document.querySelector('.board-scene').getBoundingClientRect();
  const tray = document.querySelector('.buffer-panel').getBoundingClientRect();
  const port = pointAt(1), cq = Math.min(scene.width, scene.height), w = cq * .09, beltHalf = cq * .07;
  const P = { x: scene.left - panel.left + port.x / 700 * scene.width, y: scene.top - panel.top + port.y / 600 * scene.height };
  const B = { left: tray.left - panel.left, right: tray.right - panel.left, top: tray.top - panel.top, height: tray.height };
  const below = B.top > P.y + beltHalf && P.x > B.left + w && P.x < B.right - w;
  const yIn = B.top + B.height / 2, xIn = B.left + w, yLow = P.y + beltHalf + w * .6;
  const points = below ? [[P.x, P.y], [P.x, B.top + w]]
    : yIn >= yLow ? [[P.x, P.y], [P.x, yIn], [xIn, yIn]]
    : [[P.x, P.y], [P.x, yLow], [B.left - w, yLow], [B.left - w, yIn], [xIn, yIn]];
  const key = points.flat().map(Math.round).join(',') + ':' + Math.round(w);
  if (key === chuteKey) return;
  chuteKey = key;
  const d = 'M' + points.map((p) => p.join(' ')).join('L');
  // One chevron per visible stretch: the first leg starts at the belt's outer edge, the last ends at the tray edge.
  const chevrons = points.slice(1).map((end, i) => {
    const start = i === 0 ? [P.x, P.y + beltHalf] : points[i];
    const stop = i === points.length - 2 ? (below ? [end[0], B.top] : [B.left, end[1]]) : end;
    const len = Math.hypot(stop[0] - start[0], stop[1] - start[1]);
    if (len < w * .8) return '';
    const mx = (start[0] + stop[0]) / 2, my = (start[1] + stop[1]) / 2, deg = Math.atan2(stop[1] - start[1], stop[0] - start[0]) * 180 / Math.PI;
    const a = Math.min(w * .2, len * .25);
    return `<path class="chute-chevron" d="M${-a} ${-a * 1.4}L${a} 0L${-a} ${a * 1.4}" transform="translate(${mx} ${my}) rotate(${deg})"/>`;
  }).join('');
  $("return-chute").innerHTML = `<path class="chute-shadow" d="${d}" stroke-width="${w + 2}"/><path class="chute-rim" d="${d}" stroke-width="${w}"/><path class="chute-band" d="${d}" stroke-width="${w * .8}"/>${chevrons}`;
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3700);
}

function canClick() { return parentVisible && !document.hidden && !session.scenario && !session.reviewing && !session.state.result && !session.state.paused && session.pending.length === 0; }
/** Recipe strip: fresh inputs, the machine, then its output; later steps reuse items already shown.
 *  A machine with several outputs, each finished by its own one-in/one-out machine, becomes parallel lanes. */
function recipeSteps(level) {
  const order = level.orders[0];
  const recipes = level.recipes.filter((r) => order.recipeIds?.includes(r.id) ?? true);
  const items = [], shown = new Set(), used = new Set();
  const finisher = (kind) => recipes.find((r) => !used.has(r) && r.outputs.length === 1 && Object.keys(r.inputs).length === 1 && r.inputs[kind] === 1);
  for (const recipe of recipes) {
    if (used.has(recipe)) continue;
    used.add(recipe);
    const fresh = Object.entries(recipe.inputs).flatMap(([kind, n]) => Array(n).fill(kind)).filter((kind) => !shown.has(kind));
    for (const kind of fresh) { if (items.length) items.push({ sep: items.at(-1).kind ? 'plus' : 'next' }); items.push({ kind }); shown.add(kind); }
    if (items.length) items.push({ sep: 'next' });
    items.push({ room: recipe.room });
    if (recipe.outputs.length === 1) { items.push({ sep: 'next' }, { kind: recipe.outputs[0].kind }); shown.add(recipe.outputs[0].kind); continue; }
    const lanes = recipe.outputs.map((o) => ({ kind: o.kind, next: finisher(o.kind) }));
    if (!lanes.every((lane) => lane.next)) continue;
    items.push({ sep: 'next' }, { branch: lanes.map(({ kind, next }) => {
      used.add(next);
      shown.add(kind).add(next.outputs[0].kind);
      return [{ kind }, { sep: 'next' }, { room: next.room }, { sep: 'next' }, { kind: next.outputs[0].kind }];
    }) });
  }
  return items;
}
function recipeText(level) {
  return level.recipes.map((r) => `${roomNames[r.room]}: ${Object.keys(r.inputs).map((k) => resource[k].name.toLowerCase()).join(' + ')} → ${r.outputs.map((o) => resource[o.kind].name.toLowerCase()).join(' + ')}`).join('. ');
}
let stripLevel = null;
function renderRecipe(state) {
  if (stripLevel === state.level.id) return;
  stripLevel = state.level.id;
  const step = (item) => item.branch ? `<span class="recipe-branch">${item.branch.map((lane) => `<span class="recipe-lane">${lane.map(step).join('')}</span>`).join('')}</span>`
    : item.sep ? `<i class="recipe-sep ${item.sep}"></i>`
    : item.room ? `<img class="recipe-icon machine" src="${roomArt[item.room]}" alt="" title="${roomNames[item.room]}">`
    : `<img class="recipe-icon" src="${resource[item.kind].img}" alt="" title="${resource[item.kind].name}">`;
  $("recipe-strip").innerHTML = recipeSteps(state.level).map(step).join('');
  $("recipe-strip").setAttribute('aria-label', `Рецепт. ${recipeText(state.level)}`);
}

function renderQueues(state) {
  if (!$("queues").children.length) $("queues").innerHTML = state.queues.map((_, i) => `<div class="queue"><button class="queue-head" data-source="Q${i + 1}"></button></div>`).join('');
  state.queues.forEach((q, i) => {
    const first = q[0], pending = first && session.pending.some((c) => c.capsuleId === first.id);
    const button = $("queues").children[i].querySelector('button');
    button.dataset.capsule = first?.id ?? '';
    button.classList.toggle('pending', !!pending);
    button.classList.toggle('empty', !first);
    button.disabled = !first || !canClick();
    button.setAttribute('aria-label', `Очередь ${i + 1}: ${first ? `запустить ${resource[first.kind].short}${q.length > 1 ? `, дальше ${q.slice(1).map((c) => resource[c.kind].short).join(', ')}` : ''}` : 'пустая'}`);
    const [light, face, shade] = dispenserColors[first ? first.kind : 'empty'] ?? dispenserColors.default;
    const slot = (c, cls) => c ? ball(c.kind, `dispenser-ball ${cls}`) : `<span class="dispenser-ball ${cls} blank"></span>`;
    const content = `<span class="dispenser-cap"></span><span class="dispenser-body"><span class="dispenser-tube">${q.length > 2 ? `<span class="dispenser-more">+${q.length - 2}</span>` : ''}${slot(q[1], 'next')}${slot(first, 'front')}</span>`
      + `<span class="dispenser-button" style="--btn-light:${light};--btn:${face};--btn-shade:${shade}"></span></span>`
      + `<span class="resource-info"><b>${first ? resource[first.kind].name : 'Пусто'}</b><small>${pending ? 'Запускаем…' : first ? 'Запустить' : 'Всё в работе'}</small></span><span class="key-hint">${i + 1}</span>`;
    if (button.innerHTML !== content) button.innerHTML = content;
  });
  $("queue-help").textContent = session.reviewing ? "Просмотр истории" : session.scenario ? "Автоматический показ" : session.state.result ? "Уровень завершён" : session.state.paused ? "Сначала продолжи игру" : session.pending.length ? "Шарик входит…" : "Нажми кнопку дозатора";
}

function renderBuffer(state) {
  if (!$("buffer-slots").children.length) $("buffer-slots").innerHTML = state.buffer.map((_, i) => `<button class="buffer-slot" data-source="B" data-slot="${i + 1}"></button>`).join('');
  state.buffer.forEach((c, i) => {
    const button = $("buffer-slots").children[i];
    const pending = c && session.pending.some((cmd) => cmd.capsuleId === c.id);
    button.classList.toggle('occupied', !!c);
    button.classList.toggle('pending', !!pending);
    button.dataset.capsule = c?.id ?? '';
    button.disabled = !c || !canClick();
    button.setAttribute('aria-label', `Буфер ${i + 1}: ${c ? 'запустить ' + resource[c.kind].short : 'свободное место'}`);
    const content = c ? ball(c.kind, 'buffer-ball') : '';
    if (button.innerHTML !== content) button.innerHTML = content;
  });
  const n = state.buffer.filter(Boolean).length;
  $("buffer-count").textContent = `${n} / 4`;
  document.querySelector(".buffer-panel").classList.toggle("full", n === 4);
  const soon = state.belt.filter((c) => {
    const steps = (1 - c.pos + 16) % 16;
    return steps > 0 && steps <= 3 && c.distance + steps >= 16;
  }).length;
  $("buffer-hint").textContent = n === 4 ? `Буфер полон.${soon ? ' Шарик уже приближается!' : ''} Освободи место до следующего возврата.` : "Нажми на шарик, чтобы запустить его ещё раз.";
}

function renderRooms(state) {
  for (const [id, room] of Object.entries(state.rooms)) {
    const el = $(`room-${id}`);
    el.classList.toggle("processing", room.status === "PROCESSING");
    el.classList.toggle("waiting", room.status === "OUTPUT_WAIT");
    el.classList.toggle("inactive", room.status === "INACTIVE");
    const operation = state.operations.find((o) => o.id === room.operationId);
    const recipe = state.level.recipes.find((r) => r.id === operation?.recipeId) ?? state.level.recipes.find((r) => r.room === id);
    const mask = state.orders[0].product === 'plant_mask';
    let label = mask ? { cold: "Ждёт сок", heater: "Ждёт мякоть", mixer: "Ждёт обе части", centrifuge: "Ждёт основу" }[id] : waitingText[id], progress = 0;
    if (room.status === "INACTIVE") label = "Не нужна для этого рецепта";
    else if (room.status === "PROCESSING") { label = { heater: mask ? "Размягчает мякоть" : "Плавит воск", mixer: "Смешивает", cold: "Охлаждает", centrifuge: "Разделяет" }[id]; progress = (1 - room.remainingTicks / recipe.durationTicks) * 100; }
    else if (room.status === "OUTPUT_WAIT") { label = "Ждёт место на конвейере"; progress = 100; }
    else if (room.status === "COLLECTING") {
      const missing = Object.entries(recipe.inputs).filter(([kind, count]) => room.inputs.filter((c) => c.kind === kind).length < count).map(([kind]) => resource[kind].short);
      label = `Ждёт ${missing.join(' и ')}`;
    } else if (!state.operations.some((o) => o.room === id && o.status === "PLANNED")) label = "Работа завершена";
    el.querySelector(".room-status").textContent = label;
    if (recipe) el.querySelector('.room-format').textContent = `${Object.values(recipe.inputs).reduce((sum, n) => sum + n, 0)} → ${recipe.outputs.length}`;
    el.querySelector(".room-progress i").style.width = `${progress}%`;
    const inputs = room.status === "OUTPUT_WAIT"
      ? room.outputs.map((c) => `<span class="ingredient-mini received" title="Готово: ${resource[c.kind].name}"><img src="${resource[c.kind].img}" alt=""></span>`).join('')
      : recipe ? Object.entries(recipe.inputs).flatMap(([kind, count]) => Array.from({ length: count }, (_, i) => {
        const received = room.inputs.filter((c) => c.kind === kind).length > i;
        return `<span class="ingredient-mini ${received ? 'received' : ''}" title="${resource[kind].name}: ${received ? 'получено' : 'нужно'}"><img src="${resource[kind].img}" alt=""></span>`;
      })).join('') : '';
    if (el.dataset.inputs !== inputs) { el.querySelector(".room-inputs").innerHTML = inputs; el.dataset.inputs = inputs; }
    el.setAttribute("aria-label", `${roomNames[id]}. ${label}`);
  }
}

function placeToken(el, pos) {
  const p = pointAt(pos);
  el.style.left = `${p.x / 7}%`;
  el.style.top = `${p.y / 6}%`;
}
function renderTokens(state, animate) {
  const layer = $("belt-tokens");
  const ids = new Set(state.belt.map((c) => c.id));
  for (const el of [...layer.children]) if (!ids.has(el.dataset.id)) { animations.delete(el.dataset.id); el.remove(); }
  for (const c of state.belt) {
    let el = [...layer.children].find((node) => node.dataset.id === c.id);
    const existed = !!el;
    if (!el) {
      el = document.createElement("div");
      el.className = "belt-token";
      el.dataset.id = c.id;
      el.innerHTML = `<img src="${resource[c.kind].img}" alt=""><span class="token-caption">${resource[c.kind].name}</span>`;
      layer.append(el);
    }
    el.setAttribute("aria-label", `${resource[c.kind].name}, позиция ${c.pos}`);
    const steps = (1 - c.pos + 16) % 16;
    el.classList.toggle("return-soon", steps > 0 && steps <= 3 && c.distance + steps >= 16);
    const oldPos = Number(el.dataset.pos);
    if (animate && existed && !reducedMotion.matches && (oldPos + 1) % 16 === c.pos) {
      animations.set(c.id, { el, from: oldPos, to: c.pos, start: performance.now(), duration: Math.min(500, baseInterval / Number($("speed").value) * .65) });
    } else { animations.delete(c.id); placeToken(el, c.pos); }
    el.dataset.pos = c.pos;
  }
}

function renderPacking(state, now = performance.now()) {
  const view = packing.view(state, now);
  const product = state.orders[0].product;
  const mask = product === 'plant_mask';
  const box = $("packing-box");
  box.className = `packing-art ${mask ? 'mask-box' : 'cream-box'}${view.closed ? ' closed' : ''}`;
  box.setAttribute('aria-label', `${view.closed ? 'Закрытая' : 'Открытая'} коробочка для ${mask ? 'маски' : 'крема'}`);
  $("packing-dock").dataset.phase = view.credited ? 'packed' : view.pending ? 'arriving' : view.closed ? 'complete' : 'ready';
  $("packing-credit").hidden = !view.credited;
  renderOrderCount(state.orders[0].batches, view.count);
  const status = `Упаковано: ${view.count} из ${state.orders[0].batches}`;
  if ($("packing-status").textContent !== status) $("packing-status").textContent = status;
  const layer = $("packing-tokens");
  const ids = new Set(view.motions.map((motion) => motion.eventId));
  for (const el of [...layer.children]) if (!ids.has(el.dataset.event)) el.remove();
  for (const motion of view.motions) {
    let el = [...layer.children].find((node) => node.dataset.event === motion.eventId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'belt-token packing-token';
      el.dataset.event = motion.eventId;
      el.innerHTML = `<img src="${resource[motion.product].img}" alt="">`;
      layer.append(el);
    }
    const f = motion.progress;
    el.hidden = f >= .7;
    const port = state.level.board.packingPosition;
    if (f < .35) {
      placeToken(el, port - 1 + f / .35);
      el.style.transform = 'translate(-50%,-50%)';
    } else {
      const start = pointAt(port), t = Math.min(1, (f - .35) / .35);
      el.style.left = `${(start.x + (DOCK_X - start.x) * t) / 7}%`;
      el.style.top = `${start.y / 6}%`;
      el.style.transform = `translate(-50%,-50%) scale(${1 - t * .4})`;
    }
  }
}

/** Where each cue starts, read before the DOM moves on: the dispenser or buffer ball, or the belt token. */
function motionSources(cues) {
  const sources = new Map();
  for (const cue of cues) {
    const node = cue.type === 'CapsuleLaunched'
      ? document.querySelector(`#queues button[data-capsule="${cue.capsuleId}"] .dispenser-ball.front, #buffer-slots button[data-capsule="${cue.capsuleId}"] .buffer-ball`)
      : document.querySelector(`#belt-tokens [data-id="${cue.capsuleId}"]`);
    if (node) sources.set(cue.eventId, node.getBoundingClientRect());
  }
  return sources;
}
const onScreen = (r) => r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
function fly(src, from, to, { duration, lift = 0, endScale, onDone }) {
  const el = document.createElement('img');
  el.src = src; el.alt = ''; el.className = 'fly-ball';
  el.style.cssText = `left:${from.left + from.width / 2}px;top:${from.top + from.height / 2}px;width:${from.width}px;height:${from.height}px`;
  flyLayer.append(el);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = endScale ?? to.width / from.width;
  const animation = el.animate([
    { transform: 'translate(-50%,-50%)' },
    { transform: `translate(-50%,-50%) translate(${dx / 2}px,${dy / 2 - lift}px) scale(${(1 + scale) / 2 * 1.08})`, offset: .5 },
    { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${scale})`, opacity: endScale === undefined ? 1 : .2 },
  ], { duration, easing: 'cubic-bezier(.33,.1,.35,1)' });
  const done = () => { if (!flights.delete(animation)) return; el.remove(); onDone?.(); };
  flights.add(animation);
  animation.onfinish = done;
  animation.oncancel = done;
}
/** Launch: dispenser → belt start. Return: belt → buffer slot. Intake: belt → room, which gulps it. */
function playMotions(cues, sources, state) {
  const duration = Math.min(520, baseInterval / Number($("speed").value) * .7);
  for (const cue of cues) {
    const from = sources.get(cue.eventId), kind = kindFor(state, cue.capsuleId);
    if (!from || !resource[kind]) continue;
    const src = resource[kind].img;
    if (cue.type === 'CapsuleLaunched') {
      const token = document.querySelector(`#belt-tokens [data-id="${cue.capsuleId}"]`);
      const to = token?.getBoundingClientRect();
      if (!to || !onScreen(from) || !onScreen(to)) continue;
      token.style.opacity = '0';
      fly(src, from, to, { duration, lift: Math.min(60, Math.abs(to.top - from.top) * .2), onDone: () => { token.style.opacity = ''; } });
    } else if (cue.type === 'CapsuleParked') {
      const slot = $("buffer-slots").children[cue.slot - 1], ballEl = slot?.querySelector('.buffer-ball');
      const to = ballEl?.getBoundingClientRect();
      if (!to || !onScreen(from) || !onScreen(to)) continue;
      ballEl.style.opacity = '0';
      fly(src, from, to, { duration, lift: 30, onDone: () => { ballEl.style.opacity = ''; replay(slot, 'landing'); } });
    } else if (cue.type === 'IngredientAccepted') {
      const room = $(`room-${cue.roomId}`), to = room?.querySelector('.machine-visual').getBoundingClientRect();
      if (!to || !onScreen(from)) continue;
      fly(src, from, to, { duration: duration * .8, endScale: .35, onDone: () => replay(room, 'gulp') });
    }
  }
}
function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); el.addEventListener('animationend', () => el.classList.remove(cls), { once: true }); }
function finishFlights() { for (const animation of [...flights]) animation.finish(); }

function renderOrderCount(batches, count) {
  $("order-count").textContent = `${count}/${batches}`;
  const pips = Array.from({ length: batches }, (_, i) => `<i class="${i < count ? 'done' : ''}"></i>`).join('');
  if ($("order-pips").innerHTML !== pips) $("order-pips").innerHTML = pips;
}

function kindFor(state, id) {
  return state.level.queues.flat().find((c) => c.id === id)?.kind ?? state.operations.flatMap((o) => o.outputs).find((c) => c.id === id)?.kind;
}
function eventDescription(state, e) {
  const r = resource[kindFor(state, e.capsuleId)]?.name ?? e.capsuleId ?? '';
  const room = roomNames[e.roomId];
  switch (e.type) {
    case "CapsuleLaunched": return `${r} → конвейер`;
    case "IngredientAccepted": return `${room} принимает: ${r.toLowerCase()}`;
    case "ProcessingStarted": return `${room}: рецепт собран, обработка началась`;
    case "ProcessingFinished": return `${room}: результат готов`;
    case "OutputReleased": return `${room} → ${r.toLowerCase()} на конвейере`;
    case "OutputBlocked": return `${room} ждёт: ${e.reasons.includes('BELT_CAPACITY') ? 'конвейер заполнен' : 'выход занят'}`;
    case "CapsuleParked": return `${r} → место ${e.slot} в буфере`;
    case "ProductDelivered": return `${r}: доставлено ${e.count}`;
    case "LaunchRejected": return reasons[e.reason] ?? 'Запуск не состоялся';
    case "LevelWon": return 'Заказ выполнен. Мастерская справилась!';
    case "LevelLost": return e.reason === 'RETURN_OVERFLOW' ? 'В буфере не осталось места' : 'Невозможно продолжить рецепт';
    default: return null;
  }
}
function renderEvents(state) {
  const meaningful = state.events.filter((e) => eventDescription(state, e));
  $("event-count").textContent = meaningful.length;
  $("event-list").innerHTML = meaningful.slice(-14).reverse().map((e) => `<li><span>${e.tick}</span><div><b>${escape(eventDescription(state, e))}</b><details><summary>Причина и детали</summary><code>${escape(e.type)}<br>${escape(e.eventId)}${e.causeId ? `<br>← ${escape(e.causeId)}` : ''}<br>Фаза ${e.phase}</code></details></div></li>`).join('') || '<li>Здесь появятся события мастерской.</li>';
}

function renderGuide(state) {
  let title = "Выбери следующую порцию", text = "Смотри, чего ждут комнаты. Возвращай шарики из буфера, когда для них освободится место.";
  let suggested = null, bufferId = null;
  if (session.reviewing) { title = `Просмотр шага ${state.tick}`; text = "История не меняет игру. Вернись к текущему состоянию, чтобы продолжить."; }
  else if (state.result === "WIN") { title = "Заказ доставлен"; text = nextCampaignLevel(session.levelId) ? "Заказ готов! Переходи к следующему уровню — там новое решение." : session.levelId === 'L5' ? "Первая маска готова! Центрифуга разделила основу, а обе обработанные части стали одним продуктом." : "Весь заказ доставлен. Мастерская справилась!"; }
  else if (state.result === "LOSE") { title = "Почему возник затор?"; text = "В разборе игры можно вернуться на несколько шагов назад и посмотреть, чего ждали комнаты."; }
  else if (state.paused) { title = "Мастерская на паузе"; text = "Нажми «Продолжить», чтобы конвейер снова поехал. Прогресс сохранён."; }
  else if (session.scenario && session.levelId !== 'L5') { title = "Пример играет сам"; text = "Следи за шариками. Чтобы попробовать свои решения, выбери «Играть самостоятельно»."; }
  else if (state.buffer.every(Boolean)) { title = "Освободи место"; text = "Полный буфер ещё не означает поражение. Запусти шарик повторно до следующего возврата."; }
  else if (session.levelId === 'L5') { ({ title, text, suggested = null } = maskGuide(state)); }
  else if (Object.values(state.rooms).some((r) => r.status === 'OUTPUT_WAIT')) { title = "Готово, но выход занят"; text = "Результат ждёт в комнате. Он выйдет, когда на конвейере освободится место."; }
  else if (session.levelId === 'L1') {
    const next = ['wax_solid', 'oil', 'water'].find((kind) => state.queues.some((q) => q[0]?.kind === kind));
    if (session.pending.length) { title = "Шарик входит на конвейер"; text = "Через вход проходит один шарик за раз. Следующую порцию можно запустить через мгновение."; }
    else if (next === 'wax_solid') { title = "1. Начни с воска"; text = "Нажми на воск внизу. Конвейер отвезёт его к нагреву, и воск станет жидким."; suggested = next; }
    else if (next === 'oil') { title = "2. Добавь масло"; text = "Нажми на масло. Смеситель заберёт его автоматически и подождёт остальные ингредиенты."; suggested = next; }
    else if (next === 'water') { title = "3. Добавь воду"; text = "Нажми на воду. Для крема нужны масло, вода и растопленный воск."; suggested = next; }
    else if (state.belt.some((c) => c.kind === 'cream') || state.rooms.cold.status === 'OUTPUT_WAIT') { title = "Крем готов — осталось доставить"; text = "Баночка доедет до упаковки, и заказ будет выполнен. Нажимать больше не нужно."; }
    else if (state.belt.some((c) => c.kind === 'cream_warm') || state.rooms.cold.status === 'PROCESSING') { title = "Смесь отправляется на охлаждение"; text = "Холод превратит тёплую смесь в крем. Комнаты и конвейер работают сами."; }
    else if (state.rooms.mixer.status === 'PROCESSING') { title = "Все ингредиенты собраны"; text = "Смеситель готовит тёплую смесь. Затем она отправится в комнату холода."; }
    else if (state.buffer.some(Boolean)) { title = "Верни шарик в работу"; text = "Нажми на шарик в буфере, чтобы снова запустить его на конвейер."; }
    else { title = "Теперь работают комнаты"; text = "Воск растает и доедет до смесителя. Дождись, пока соберутся все три ингредиента."; }
  } else if (CAMPAIGN.some((l) => l.id === session.levelId)) {
    ({ title, text, suggested = null, bufferId = null } = campaignGuide(state));
  }
  $("guide-title").textContent = title;
  $("guide-text").textContent = text;
  for (const button of $("queues").querySelectorAll('button')) {
    const q = state.queues[Number(button.dataset.source.slice(1)) - 1];
    button.classList.toggle('suggested', !!suggested && q[0]?.kind === suggested);
  }
  for (const button of $("buffer-slots").querySelectorAll('button')) button.classList.toggle('suggested', button.dataset.capsule === bufferId);
}

function renderResult(state) {
  const visible = state.result && resultDismissed !== state.runId && !session.reviewing && !packing.active.length;
  $("result-overlay").hidden = !visible;
  const next = nextCampaignLevel(session.levelId);
  $("next-level").hidden = !visible || state.result !== "WIN" || !next;
  $("next-level").textContent = next ? `Дальше: ${CAMPAIGN.find((l) => l.id === next).title}` : 'Следующий уровень';
  if (!visible) return;
  $("result-icon").innerHTML = state.result === 'WIN' ? `<img src="${resource[state.orders[0].product].img}" alt="">` : icon('reset');
  $("result-title").textContent = state.result === 'WIN' ? 'Заказ выполнен!' : 'Поток остановился';
  $("result-description").textContent = state.result === 'WIN'
    ? `Доставлено баночек: ${state.orders[0].delivered} из ${state.orders[0].batches}.${session.levelId === 'L5' ? ' Первая растительная маска готова!' : ' Весь заказ выполнен.'}`
    : 'Следующий шарик вернулся, когда буфер был полон. Попробуй другой порядок запуска или посмотри историю.';
}

function render(animate = false) {
  const state = session.view;
  packing.sync(state, { animate, now: performance.now(), speed: Number($("speed").value),
    instant: session.reviewing || state.paused || !parentVisible || document.hidden || reducedMotion.matches });
  const cues = motion.take(state, { animate: animate && !session.reviewing && parentVisible && !document.hidden && !reducedMotion.matches });
  const sources = motionSources(cues);
  const level = CAMPAIGN.find((l) => l.id === session.levelId);
  $("level-title").textContent = level ? `${CAMPAIGN.indexOf(level) + 1} / ${CAMPAIGN.length} · ${level.title}` : 'Контроль потока · J1';
  $("level-select").value = session.levelId;
  $("order-description").textContent = level?.goal ?? 'Контрольный сценарий на четыре баночки';
  const order = state.orders[0];
  const mask = order.product === 'plant_mask';
  $("product-name").textContent = mask ? resource[order.product].name : 'Нежный крем';
  if (!$("product-jar").src.endsWith(resource[order.product].img)) $("product-jar").src = resource[order.product].img;
  renderRecipe(state);
  $("capacity-count").textContent = `${state.belt.length} / 6`;
  $("capacity-dots").innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < state.belt.length ? 'filled' : ''}"></i>`).join('');
  $("belt-capacity").classList.toggle('full', state.belt.length === 6);
  $("play").innerHTML = icon(session.playing ? 'pause' : 'play') + `<span>${session.playing ? 'Пауза' : session.ready ? 'Начать' : 'Продолжить'}</span>`;
  $("play").disabled = !!session.state.result || session.reviewing;
  $("step").disabled = !!session.state.result || session.reviewing;
  $("clock-label").textContent = session.reviewing ? `История · шаг ${state.tick}` : session.ready ? 'Готово к старту' : `${session.playing ? 'В движении' : state.result ? 'Завершено' : 'Пауза'} · ${state.tick}`;
  $("watch-demo").textContent = session.scenario ? "Показать сначала" : "Посмотреть пример";
  $("mode-banner").hidden = !session.scenario && !session.reviewing && !session.state.paused;
  $("mode-text").textContent = session.reviewing ? `История · шаг ${state.tick}` : session.scenario ? "Демонстрация · автоматический запуск" : "Игра на паузе";
  $("manual-mode").textContent = session.reviewing ? "К текущему состоянию" : session.scenario ? "Играть самостоятельно" : "Продолжить";
  $("finish-demo").hidden = !session.scenario;
  $("finish-demo").disabled = !!session.state.result || session.reviewing;
  $("history").max = session.frames.length - 1;
  $("history").value = session.viewIndex;
  $("history").disabled = session.frames.length <= 1;
  $("history-start").textContent = session.frames[0].tick;
  $("history-end").textContent = `${session.state.tick} шагов`;
  $("history-label").textContent = session.reviewing ? `Просмотр: шаг ${state.tick}` : 'История шагов';
  $("live").hidden = !session.reviewing;
  renderQueues(state); renderBuffer(state); renderRooms(state); renderTokens(state, animate); renderPacking(state); renderEvents(state); renderGuide(state); renderResult(state);
  playMotions(cues, sources, state);
  drawChute();
}

function reset(options) {
  finishFlights();
  session.reset(options);
  drawPorts();
  clearTimeout(toastTimer);
  $("toast").hidden = true;
  $("toast").textContent = '';
  animations.clear(); $("belt-tokens").replaceChildren();
  elapsed = 0; resultDismissed = null;
  $("demo-select").value = session.scenario?.id ?? '';
  render();
}
function handleResult(result) {
  if (!result) return;
  for (const receipt of result.commandResults) if (!receipt.ok && receipt.reason !== 'DUPLICATE_COMMAND') notify(reasons[receipt.reason] ?? 'Запуск не состоялся', true);
}
function launch(source, capsule, slot) {
  if (!canClick()) return;
  if (session.enqueue(source, capsule, slot)) { if (session.state.tick === 0) elapsed = 0; render(); }
}
function bind() {
  $("watch-demo").addEventListener('click', () => {
    if (!parentVisible || document.hidden) return;
    reset({ scenario: CAMPAIGN.find((l) => l.id === session.levelId)?.demo ?? 'B_J1_recover' });
    session.start(); elapsed = 0; render();
  });
  $("manual-mode").addEventListener('click', () => {
    if (session.reviewing) session.live();
    else if (session.scenario) reset({ level: session.levelId });
    else if (parentVisible && !document.hidden) session.start();
    elapsed = 0; render();
  });
  $("next-level").addEventListener('click', () => { const next = nextCampaignLevel(session.levelId); if (next) reset({ level: next }); });
  for (const id of ['queues', 'buffer-slots']) $(id).addEventListener('click', (e) => {
    const button = e.target.closest('button[data-source]');
    if (button && !button.disabled) launch(button.dataset.source, button.dataset.capsule, Number(button.dataset.slot) || undefined);
  });
  $("play").addEventListener('click', () => { if (session.playing) session.pause(); else if (parentVisible && !document.hidden) session.start(); elapsed = 0; render(); });
  $("step").addEventListener('click', () => { if (!parentVisible || document.hidden) return; handleResult(session.step()); elapsed = 0; render(true); });
  $("restart").addEventListener('click', () => reset({ level: session.levelId, scenario: session.scenario?.id }));
  $("result-restart").addEventListener('click', () => reset({ level: session.levelId, scenario: session.scenario?.id }));
  $("result-close").addEventListener('click', () => { resultDismissed = session.state.runId; render(); });
  $("level-select").addEventListener('change', (e) => reset({ level: e.target.value }));
  $("demo-select").addEventListener('change', (e) => reset({ level: session.levelId, scenario: e.target.value || null }));
  $("speed").addEventListener('change', () => { elapsed = 0; packing.sync(session.view, { instant: true }); render(); });
  $("finish-demo").addEventListener('click', () => { finishFlights(); session.finishDemo(); elapsed = 0; animations.clear(); render(); });
  $("history").addEventListener('input', (e) => { finishFlights(); session.seek(Number(e.target.value)); elapsed = 0; render(); });
  $("live").addEventListener('click', () => { session.live(); render(); });
  $("help-toggle").addEventListener('click', () => { const open = $("help-panel").hidden; $("help-panel").hidden = !open; $("help-toggle").setAttribute('aria-expanded', String(open)); });
  $("export-events").addEventListener('click', () => {
    const data = { version: 'flow-0.2', level: session.levelId, mode: session.scenario?.id ?? 'manual', state: checkpoint(session.view), events: session.view.events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `bubble-workshop-${session.levelId}-${session.view.tick}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); $("play").click(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); $("step").click(); }
    else if (/^Digit[1-3]$/.test(e.code)) { const i = Number(e.code.at(-1)) - 1; const c = session.state.queues[i][0]; if (c) launch(`Q${i + 1}`, c.id); }
    else if (['KeyQ', 'KeyW', 'KeyE', 'KeyR'].includes(e.code)) { const i = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(e.code); const c = session.state.buffer[i]; if (c) launch('B', c.id, i + 1); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAway(); });
}

function pauseAway() {
  if (!session) return;
  if (session.playing) session.pause();
  elapsed = 0;
  finishFlights(); animations.clear(); render();
}

function connectPresentation() {
  if (!embedded) return;
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    if (event.data?.type === 'bubble:level') { if (CAMPAIGN.some((level) => level.id === event.data.level)) reset({ level: event.data.level }); return; }
    if (event.data?.type !== 'bubble:visibility' || typeof event.data.visible !== 'boolean') return;
    parentVisible = event.data.visible;
    if (!parentVisible) pauseAway();
    render();
  });
  let lastHeight = 0;
  const reportHeight = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({ type: 'bubble:height', height }, location.origin);
  };
  new ResizeObserver(reportHeight).observe(document.body);
  reportHeight();
  window.parent.postMessage({ type: 'bubble:ready' }, location.origin);
}

function frame(now) {
  const delta = Math.min(now - lastClock, 200);
  lastClock = now;
  if (session?.playing) {
    elapsed += delta;
    if (elapsed >= baseInterval / Number($("speed").value)) {
      elapsed = 0;
      try { handleResult(session.advance()); render(true); }
      catch (error) { session.pause(); render(); notify(`Не удалось продолжить: ${error.message}`, true); console.error(error); }
    }
  }
  for (const [id, motion] of animations) {
    const fraction = Math.min(1, (now - motion.start) / motion.duration);
    placeToken(motion.el, motion.from + fraction);
    if (fraction === 1) animations.delete(id);
  }
  if (packing.active.length) {
    if (reducedMotion.matches) packing.sync(session.view, { instant: true, now });
    else packing.advance(now);
    renderPacking(session.view, now);
    renderResult(session.view);
  }
  requestAnimationFrame(frame);
}

try {
  const response = await fetch(new URL("../design/flow-contract-0.2/fixtures.json", import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  session = new Session(await response.json());
  const params = new URLSearchParams(location.search);
  const requestedLevel = params.get('level');
  const requestedDemo = params.get('demo');
  if (CAMPAIGN.some((level) => level.id === requestedLevel)) session.reset({ level: requestedLevel });
  if (session.fixtures.scenarios.some((scenario) => scenario.id === requestedDemo)) {
    session.reset({ scenario: requestedDemo });
    if (!embedded) session.start();
  }
  $("level-select").innerHTML = CAMPAIGN.map((l, i) => `<option value="${l.id}">${i + 1} / ${CAMPAIGN.length} — ${l.title}</option>`).join('') + '<option value="J1">J1 — Контрольный сценарий</option>';
  $("demo-select").innerHTML = '<option value="">Играю самостоятельно</option>' + CAMPAIGN.map((l, i) => `<option value="${l.demo}">${i + 1}. ${l.title} — пример</option>`).join('') + '<option value="B_J1_recover">J1 — Как выйти из затора</option><option value="H_J1_overflow">J1 — Почему возникает переполнение</option>';
  $("demo-select").value = session.scenario?.id ?? '';
  drawPorts(); bind(); connectPresentation(); render(); requestAnimationFrame(frame);
  new ResizeObserver(drawChute).observe(document.querySelector('.workshop-panel'));
  document.documentElement.dataset.gameReady = 'true';
} catch (error) {
  $("guide-title").textContent = 'Не удалось загрузить мастерскую';
  $("guide-text").textContent = 'Не удалось загрузить игру. Обнови страницу или открой игру отдельно.';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  console.error(error);
}
