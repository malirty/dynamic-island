// Smooth, springy scrolling for island pages: the wheel glides with inertia,
// cards lag behind the motion and wobble back like jelly, and the list
// stretches and bounces at the top and bottom.
const ITEMS = '.home > *, .pin > .card, .pin > .whero, .pin > .tiles > *, .pin > .days, .clips > .clip, .tgrid > *, .cc > *, .sliders > *, .powerrow > *, .pin > .row, .pin > .cliptop, .pin > .chips, .pin > .stats, .pin > textarea';

const pages = new Set();
let raf = 0;

function scrollableInside(el, page) {
  // a nested scroll area (hourly strip, chat, notes list…) keeps native scrolling
  for (let n = el; n && n !== page; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
    if (n.tagName === 'TEXTAREA') return true;
  }
  return false;
}

function attach(page) {
  if (page._jelly) return;
  const st = { target: page.scrollTop, pos: page.scrollTop, vel: 0, over: 0, overV: 0, items: [], lastPos: page.scrollTop };
  page._jelly = st;
  pages.add(page);
  page.addEventListener('wheel', (e) => {
    if (e.ctrlKey || scrollableInside(e.target, page)) return;
    const max = page.scrollHeight - page.clientHeight;
    if (max <= 0 && Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 36 : e.deltaY;
    const next = st.target + dy;
    // pushing past the ends stretches the list instead
    if (next < 0) { st.overV += -next * 0.04; st.target = 0; }
    else if (next > max) { st.overV -= (next - max) * 0.04; st.target = Math.max(0, max); }
    else st.target = next;
    kick();
  }, { passive: false });
  // manual scrolling (scrollbar drag, keyboard) keeps the target in sync
  page.addEventListener('scroll', () => { if (!raf) { st.target = st.pos = page.scrollTop; } });
}

function kick() { if (!raf) raf = requestAnimationFrame(frame); }

function frame() {
  raf = 0;
  let busy = false;
  for (const page of pages) {
    const st = page._jelly;
    if (!page.isConnected || !page.classList.contains('on')) continue;
    // glide toward the target scroll position
    const prev = st.pos;
    st.pos += (st.target - st.pos) * 0.16;
    if (Math.abs(st.target - st.pos) < 0.4) st.pos = st.target;
    page.scrollTop = st.pos;
    const v = st.pos - prev;
    st.vel = st.vel * 0.7 + v * 0.3;
    // overscroll spring (rubber band)
    st.overV += -st.over * 0.12;
    st.overV *= 0.62;
    st.over += st.overV;
    st.over = Math.max(-30, Math.min(30, st.over));
    // cards: further down the list lags more, so the stack ripples
    const items = page.querySelectorAll(ITEMS);
    const top = page.getBoundingClientRect().top;
    let i = 0;
    for (const el of items) {
      const j = el._j || (el._j = { y: 0, vy: 0, r: 0 });
      const rect = el.getBoundingClientRect();
      const depth = Math.min(1, Math.max(0, (rect.top - top) / (page.clientHeight || 1)));
      // gentle trail: lower cards follow a little later, then settle without bouncing around
      const lag = -st.vel * (0.35 + depth * 0.55) + st.over * (0.3 + depth * 0.4);
      j.vy += (Math.max(-10, Math.min(10, lag)) - j.y) * 0.22;
      j.vy *= 0.6; // strong damping: one soft overshoot at most
      j.y += j.vy;
      j.y = Math.max(-12, Math.min(12, j.y));
      const moving = Math.abs(j.y) > 0.05 || Math.abs(j.vy) > 0.05;
      el.style.translate = moving ? `0 ${j.y.toFixed(2)}px` : '';
      if (moving) busy = true;
      i++;
    }
    if (st.pos !== st.target || Math.abs(st.over) > 0.1 || Math.abs(st.overV) > 0.1) busy = true;
  }
  if (busy) raf = requestAnimationFrame(frame);
}

export function initJelly(root) {
  for (const p of root.querySelectorAll('.page')) attach(p);
  new MutationObserver(() => { for (const p of root.querySelectorAll('.page')) attach(p); }).observe(root, { childList: true, subtree: false });
}
