/* Celebração condicionada à eleição oficial de Flávio Bolsonaro para Presidente. */
(function (global) {
  'use strict';
  const NS = global.Apuracao;
  const C = global.APURACAO_CONFIG;
  const h = NS.U.h;
  const reduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dialog, canvas, ctx, title, slogan, info, closeButton, raf = 0, finishTimer = 0, stopTimer = 0;
  let activeKey = '', previousFocus, started = 0, nextBurst = 0, particles = [];
  const COLORS = ['#ffdf00', '#ffd56a', '#00ed69', '#6bff9d', '#36a4ff', '#ffffff'];

  function elected(race, data) {
    if (race.id !== 'presidente' || Number(race.cargo) !== 1 || race.uf !== 'br' || !data || !data.ts) return false;
    return (data.candidatos || []).some(c => {
      const name = String(c.nomeCompleto || c.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      return String(c.numero) === '22' && /^FLAVIO(?: NANTES)? BOLSONARO$/.test(name.trim()) &&
        (c.eleito === true || /^eleito(?:\s|$)/i.test(c.situacao || ''));
    });
  }

  function remembered(key) {
    try { return global.sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function remember(key, value) {
    try { global.sessionStorage.setItem(key, value); } catch (_) { /* continua em memória */ }
  }

  function mount() {
    if (dialog) return;
    canvas = h('canvas', { class: 'victory__fireworks', 'aria-hidden': 'true' });
    title = h('h2', { class: 'victory__brasil', id: 'victory-title' }, 'BRASIL');
    slogan = h('p', { class: 'victory__slogan', hidden: true },
      h('span', { class: 'victory__line victory__line--green' }, 'Brasil acima de tudo,'),
      h('span', { class: 'victory__line victory__line--gold' }, 'Deus acima de todos'));
    info = h('p', { class: 'victory__official' });
    closeButton = h('button', { class: 'victory__close', type: 'button', 'aria-label': 'Fechar celebração e voltar à apuração' }, 'Voltar à apuração ×');
    dialog = h('dialog', { class: 'victory', 'aria-labelledby': 'victory-title' },
      h('div', { class: 'victory__scene', 'aria-hidden': 'true' }), canvas, closeButton,
      h('div', { class: 'victory__content' },
        h('img', { class: 'victory__flag', src: 'assets/bandeira-brasil.svg', alt: 'Bandeira do Brasil', width: 700, height: 490 }),
        title, slogan, info));
    document.body.appendChild(dialog);
    ctx = canvas.getContext('2d');
    closeButton.addEventListener('click', () => hide(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); hide(true); });
    global.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') cancelAnimationFrame(raf);
      else if (dialog.open && !reduced && performance.now() - started < 9500) raf = requestAnimationFrame(frame);
    });
  }

  function resize() {
    if (!canvas || !dialog.open) return;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.round(global.innerWidth * dpr);
    canvas.height = Math.round(global.innerHeight * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst() {
    const w = global.innerWidth, hh = global.innerHeight;
    const x = w * (.08 + Math.random() * .84), y = hh * (.1 + Math.random() * .5);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const total = w < 600 ? 60 : 95;
    for (let i = 0; i < total; i++) {
      const a = Math.PI * 2 * i / total;
      const speed = 70 + Math.random() * 160;
      particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0,
        life: 1.3 + Math.random() * 1.3, color, size: 1.2 + Math.random() * 1.6 });
    }
  }

  let previousFrame = 0;
  function frame(now) {
    if (!dialog.open || !ctx || document.visibilityState === 'hidden') return;
    const elapsed = now - started;
    const dt = Math.min(.04, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    if (elapsed < 7000 && now >= nextBurst) { burst(); nextBurst = now + 260 + Math.random() * 250; }
    ctx.globalCompositeOperation = 'lighter';
    particles = particles.filter(p => p.age < p.life);
    for (const p of particles) {
      p.age += dt; p.vy += 48 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= .985; p.vy *= .992;
      ctx.globalAlpha = Math.pow(Math.max(0, 1 - p.age / p.life), .65);
      ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
      ctx.shadowColor = p.color; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.moveTo(p.x - p.vx * .08, p.y - p.vy * .08); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
    if (elapsed < 9500) raf = requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, global.innerWidth, global.innerHeight); particles = []; }
  }

  function finale() {
    if (!dialog.open) return;
    title.hidden = true;
    slogan.hidden = false;
    dialog.classList.add('victory--final');
    remember(activeKey, 'shown');
  }

  function hide(dismiss) {
    if (!dialog || !dialog.open) return;
    if (dismiss) remember(activeKey, 'dismissed');
    clearTimeout(finishTimer);
    clearTimeout(stopTimer);
    cancelAnimationFrame(raf);
    particles = [];
    dialog.close();
    document.body.classList.remove('has-victory');
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }

  function sync(race, data) {
    if (race.id !== 'presidente' || race.uf !== 'br') return;
    if (!elected(race, data)) { hide(false); activeKey = ''; return; }
    const key = `apuracao2026:victory:${C.ciclo}:${race.eleicao}:flavio`;
    if (activeKey === key) return;
    activeKey = key;
    const seen = remembered(key);
    if (seen === 'dismissed') return;
    mount();
    info.textContent = `Flávio Bolsonaro eleito presidente · confirmação do TSE · ${data.dg} ${data.hg}`;
    previousFocus = document.activeElement;
    title.hidden = false; slogan.hidden = true;
    dialog.classList.remove('victory--final');
    document.body.classList.add('has-victory');
    dialog.showModal();
    closeButton.focus();
    resize();
    if (reduced || seen === 'shown') { finale(); return; }
    started = previousFrame = performance.now(); nextBurst = started;
    raf = requestAnimationFrame(frame);
    finishTimer = setTimeout(finale, 6000);
    stopTimer = setTimeout(() => {
      cancelAnimationFrame(raf);
      particles = [];
      if (ctx) ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    }, 9500);
  }

  NS.Victory = { sync };
})(window);
