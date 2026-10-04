/*!
 * Apuração 2026 — camada de interface.
 * Atualiza o DOM de forma incremental (sem recarregar), com animação de números,
 * reordenação FLIP e gráfico de evolução em SVG.
 */
(function (global) {
  'use strict';

  const NS = global.Apuracao;
  const { U, TSE } = NS;
  const h = U.h;

  const PALETTE = ['#4f8cff', '#ff5d73', '#21c79b', '#f5b83d', '#a77bff', '#26c6e8', '#ff8a3d', '#e86bd0', '#9ccc3d', '#94a3b8', '#ffd166', '#5eead4', '#f472b6', '#60a5fa', '#c084fc'];
  const reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const panels = new Map();

  /* ---------------------------------------------------- Number tween */

  function tween(el, from, to, fmt, duration) {
    if (el._raf) cancelAnimationFrame(el._raf);
    if (reduceMotion || from === to || !Number.isFinite(from)) {
      el.textContent = fmt(to);
      return;
    }
    const d = duration || 900;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / d);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  /* --------------------------------------------------------- Painel */

  function buildPanel(race) {
    const titleId = `t-${race.id}`;
    const pctEl = h('strong', { class: 'progress__value' }, '0,00%');
    const countEl = h('span', { class: 'progress__count' }, '');
    const bar = h('span', { class: 'progress__fill' });
    const updated = h('span', { class: 'race__updated' }, 'Aguardando dados…');
    const finalBadge = h('span', { class: 'chip chip--final', hidden: true }, 'Totalização finalizada');
    const alert = h('p', { class: 'race__alert', role: 'status', hidden: true });
    const list = h('ol', { class: 'cands', 'aria-label': `Candidatos a ${race.titulo}` });
    const chartSvg = U.svg('svg', { viewBox: '0 0 640 200', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Evolução dos percentuais ao longo da apuração' });
    const chartWrap = h('figure', { class: 'chart', hidden: true },
      h('figcaption', { class: 'chart__caption' }, h('span', null, 'Evolução da apuração'), h('span', { class: 'chart__axis' }, '% votos válidos × % seções totalizadas')),
      chartSvg);
    const stat = (label) => {
      const dd = h('dd', null, '—');
      return { node: h('div', { class: 'stat' }, h('dt', null, label), dd), dd };
    };
    const sComp = stat('Comparecimento');
    const sAbst = stat('Abstenção');
    const sBran = stat('Brancos');
    const sNulo = stat('Nulos');

    const el = h('section', { class: `race race--${race.id} is-loading`, 'aria-labelledby': titleId },
      h('header', { class: 'race__head' },
        h('div', { class: 'race__titles' },
          h('p', { class: 'race__eyebrow' }, race.local),
          h('h2', { class: 'race__title', id: titleId }, race.titulo),
          race.cargo === 5 ? h('p', { class: 'race__hint' }, 'Mais votados ocupam as vagas em disputa') : null),
        h('div', { class: 'race__meta' }, finalBadge, updated)),
      h('div', { class: 'progress', role: 'group', 'aria-label': 'Seções totalizadas' },
        h('div', { class: 'progress__row' }, h('span', { class: 'progress__label' }, 'Seções totalizadas'), pctEl),
        h('div', { class: 'progress__track' }, bar),
        countEl),
      alert,
      list,
      h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      chartWrap,
      h('dl', { class: 'stats' }, sComp.node, sAbst.node, sBran.node, sNulo.node));

    return {
      race, el, list, pctEl, countEl, bar, updated, finalBadge, alert, chartWrap, chartSvg,
      stats: { comp: sComp.dd, abst: sAbst.dd, bran: sBran.dd, nulo: sNulo.dd },
      rows: new Map(), colors: new Map(), mode: null, vPct: 0, last: null
    };
  }

  function mount(container, races) {
    container.textContent = '';
    for (const race of races) {
      const p = buildPanel(race);
      panels.set(race.id, p);
      container.appendChild(p.el);
    }
  }

  /* ------------------------------------------------------ Candidato */

  function buildPhoto(race, c) {
    const wrap = h('div', { class: 'cand__photo' }, h('span', { class: 'cand__initials', 'aria-hidden': 'true' }, U.initials(c.nome)));
    const img = new Image();
    img.alt = `Foto de ${c.nome}`;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.width = 120;
    img.height = 160;
    img.addEventListener('load', () => wrap.classList.add('has-img'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = TSE.photoUrl(race, c.sq);
    wrap.appendChild(img);
    return wrap;
  }

  function buildRow(p, c) {
    const r = {
      rank: h('span', { class: 'cand__rank', 'aria-hidden': 'true' }),
      name: h('span', { class: 'cand__name' }),
      tag: h('span', { class: 'tag', hidden: true }),
      party: h('span', { class: 'cand__party' }),
      fill: h('span', { class: 'cand__fill' }),
      pct: h('strong', { class: 'cand__pct' }, '0,00%'),
      votes: h('span', { class: 'cand__votes' }, ''),
      delta: h('span', { class: 'cand__delta', 'aria-hidden': 'true' }),
      num: h('span', { class: 'cand__num' }),
      vPct: 0,
      vVotes: 0
    };
    r.el = h('li', { class: 'cand' },
      r.rank,
      buildPhoto(p.race, c),
      h('div', { class: 'cand__body' },
        h('div', { class: 'cand__line' }, r.name, r.tag),
        r.party,
        h('div', { class: 'cand__bar' }, r.fill)),
      h('div', { class: 'cand__nums' }, r.pct, r.votes, r.delta, r.num));
    return r;
  }

  function tagFor(c) {
    if (c.eleito || /^eleit/i.test(c.situacao)) return ['Eleito', 'tag--win'];
    if (/2.?\s*turno/i.test(c.situacao)) return ['2º turno', 'tag--runoff'];
    if (/anulad|cassad|indefer|sub ?j/i.test(c.destino)) return [c.destino, 'tag--muted'];
    return null;
  }

  function fillRow(p, r, c, i, prevPct, counting) {
    r.el.style.setProperty('--c', p.colors.get(c.sq) || PALETTE[0]);
    r.el.classList.toggle('is-leader', counting && i === 0);
    r.rank.textContent = counting ? `${i + 1}º` : '';
    r.name.textContent = c.nome;
    r.name.title = c.nomeCompleto;
    r.party.textContent = [c.partido, c.numero, c.coligacao].filter(Boolean).join(' · ');
    r.num.textContent = c.numero;

    const t = tagFor(c);
    r.tag.hidden = !t;
    if (t) {
      r.tag.textContent = t[0];
      r.tag.className = `tag ${t[1]}`;
    }

    tween(r.pct, r.vPct, c.pct, U.fmtPct);
    tween(r.votes, r.vVotes, c.votos, (n) => `${U.fmtInt(n)} votos`);
    r.vPct = c.pct;
    r.vVotes = c.votos;
    r.fill.style.width = `${U.clamp(c.pct, 0, 100)}%`;

    r.el.setAttribute('aria-label',
      counting ? `${i + 1}º lugar: ${c.nome}, ${c.partido}, ${U.fmtPct(c.pct)}, ${U.fmtInt(c.votos)} votos` : `${c.nome}, ${c.partido}, número ${c.numero}`);

    if (counting && prevPct !== undefined) {
      const d = c.pct - prevPct;
      if (Math.abs(d) >= 0.005) {
        r.delta.textContent = `${d > 0 ? '▲' : '▼'} ${U.fmtPctPlain(Math.abs(d))}`;
        r.delta.className = `cand__delta ${d > 0 ? 'is-up' : 'is-down'}`;
        if (!reduceMotion) {
          r.el.classList.remove('is-flash');
          void r.el.offsetWidth; // reinicia a animação
          r.el.classList.add('is-flash');
        }
      } else {
        r.delta.textContent = '';
        r.delta.className = 'cand__delta';
      }
    }
  }

  function assignColors(p, candidatos) {
    if (p.colors.size === candidatos.length) return;
    candidatos.slice()
      .sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0))
      .forEach((c, i) => p.colors.set(c.sq, PALETTE[i % PALETTE.length]));
  }

  function renderRows(p, list, counting, prevMap) {
    const mode = counting ? 'count' : 'pre';
    if (p.mode !== mode) {
      p.rows.forEach((r) => r.el.remove());
      p.rows.clear();
      p.mode = mode;
    }

    const first = new Map();
    if (!reduceMotion) p.rows.forEach((r, sq) => first.set(sq, r.el.getBoundingClientRect().top));

    const keep = new Set(list.map((c) => c.sq));
    p.rows.forEach((r, sq) => {
      if (!keep.has(sq)) {
        r.el.remove();
        p.rows.delete(sq);
      }
    });

    list.forEach((c, i) => {
      let r = p.rows.get(c.sq);
      if (!r) {
        r = buildRow(p, c);
        p.rows.set(c.sq, r);
      }
      fillRow(p, r, c, i, prevMap ? prevMap.get(c.sq) : undefined, counting);
      p.list.appendChild(r.el); // appendChild move nós existentes → aplica a nova ordem
    });

    if (reduceMotion || typeof Element.prototype.animate !== 'function') return;
    list.forEach((c) => {
      const r = p.rows.get(c.sq);
      const f = first.get(c.sq);
      if (f === undefined) {
        r.el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' });
        return;
      }
      const dy = f - r.el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        r.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
  }

  /* ---------------------------------------------------------- Gráfico */

  function niceCeil(v, steps) {
    for (const s of steps) if (v <= s) return s;
    return steps[steps.length - 1];
  }

  function renderChart(p, history, visible) {
    const svg = p.chartSvg;
    const points = (history || []).filter((s) => s && s.c);
    if (points.length < 2 || !visible.length) {
      p.chartWrap.hidden = true;
      return;
    }
    p.chartWrap.hidden = false;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const W = 640, H = 200, L = 34, R = 14, T = 10, B = 22;
    const maxX = niceCeil(Math.max(1, ...points.map((s) => s.x)), [1, 2, 5, 10, 20, 25, 50, 75, 100]);
    let maxPct = 0;
    for (const s of points) for (const c of visible) maxPct = Math.max(maxPct, s.c[c.sq] || 0);
    const maxY = niceCeil(maxPct + 4, [10, 20, 30, 40, 50, 60, 70, 80, 100]);
    const sx = (x) => L + (U.clamp(x, 0, maxX) / maxX) * (W - L - R);
    const sy = (y) => T + (1 - U.clamp(y, 0, maxY) / maxY) * (H - T - B);

    for (let k = 0; k <= 4; k++) {
      const yv = (maxY * k) / 4;
      const y = sy(yv);
      svg.appendChild(U.svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'chart__grid' }));
      const t = U.svg('text', { x: L - 6, y: y + 3, class: 'chart__label', 'text-anchor': 'end' });
      t.textContent = `${Math.round(yv)}%`;
      svg.appendChild(t);
    }
    if (maxY > 50) {
      const y50 = sy(50);
      svg.appendChild(U.svg('line', { x1: L, x2: W - R, y1: y50, y2: y50, class: 'chart__half' }));
    }
    [[0, 'start'], [maxX, 'end']].forEach(([xv, anchor]) => {
      const t = U.svg('text', { x: sx(xv), y: H - 5, class: 'chart__label', 'text-anchor': anchor });
      t.textContent = `${xv}% seções`;
      svg.appendChild(t);
    });

    for (const c of visible.slice().reverse()) {
      const pts = points.filter((s) => s.c[c.sq] !== undefined).map((s) => `${sx(s.x).toFixed(1)},${sy(s.c[c.sq]).toFixed(1)}`);
      if (pts.length < 2) continue;
      const color = p.colors.get(c.sq) || PALETTE[0];
      svg.appendChild(U.svg('polyline', { points: pts.join(' '), class: 'chart__line', stroke: color }));
      const [lx, ly] = pts[pts.length - 1].split(',');
      svg.appendChild(U.svg('circle', { cx: lx, cy: ly, r: 3.5, fill: color, class: 'chart__dot' }));
    }
  }

  /* ---------------------------------------------------- Atualização */

  function update(id, data, prev, history) {
    const p = panels.get(id);
    if (!p || !data) return;
    p.el.classList.remove('is-loading');
    assignColors(p, data.candidatos);

    const counting = !!data.contando;
    p.el.classList.toggle('is-pre', !counting);
    p.el.classList.toggle('is-final', !!data.finalizada);

    tween(p.pctEl, p.vPct, data.secoes.pct, U.fmtPct);
    p.vPct = data.secoes.pct;
    p.bar.style.width = `${data.secoes.pct}%`;
    p.countEl.textContent = data.secoes.total
      ? `${U.fmtInt(data.secoes.totalizadas)} de ${U.fmtInt(data.secoes.total)} seções`
      : '';
    p.finalBadge.hidden = !data.finalizada;
    p.updated.textContent = data.hg ? `TSE · ${data.dg ? data.dg.slice(0, 5) + ' ' : ''}${data.hg}` : '';

    const list = counting
      ? data.candidatos.slice().sort((a, b) => b.votos - a.votos || b.pct - a.pct).slice(0, p.race.top)
      : data.candidatos.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const prevMap = prev && prev.contando && prev.idg !== data.idg
      ? new Map(prev.candidatos.map((c) => [c.sq, c.pct]))
      : null;

    renderRows(p, list, counting, prevMap);

    p.stats.comp.textContent = counting ? U.fmtPct(data.comparecimentoPct) : '—';
    p.stats.abst.textContent = counting ? U.fmtPct(data.abstencaoPct) : '—';
    p.stats.bran.textContent = counting ? U.fmtPct(data.brancosPct) : '—';
    p.stats.nulo.textContent = counting ? U.fmtPct(data.nulosPct) : '—';

    renderChart(p, counting ? history : null, list);
    p.last = data;
  }

  function setStale(id, stale, message) {
    const p = panels.get(id);
    if (!p) return;
    p.el.classList.toggle('is-stale', !!stale);
    p.alert.hidden = !stale;
    if (stale) p.alert.textContent = message;
  }

  /* --------------------------------------------- Elementos globais */

  const $ = (sel) => document.querySelector(sel);

  function setStatus(kind, text) {
    const el = $('#status');
    if (!el) return;
    el.className = `status status--${kind}`;
    const t = el.querySelector('.status__text');
    if (t.textContent !== text) t.textContent = text;
  }

  function setOffline(show, timeText) {
    const el = $('#offline-banner');
    if (!el) return;
    el.hidden = !show;
    if (show) $('#offline-time').textContent = timeText || '—';
  }

  function setTimer(fraction) {
    const el = $('#timer-bar');
    if (el) el.style.transform = `scaleX(${U.clamp(fraction, 0, 1)})`;
  }

  function setMeta(text) {
    const el = $('#meta-line');
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setCountdown(msLeft) {
    const el = $('#countdown');
    if (!el) return;
    if (msLeft <= 0) {
      if (!el.hidden) el.hidden = true;
      document.body.classList.remove('is-countdown');
      return;
    }
    el.hidden = false;
    document.body.classList.add('is-countdown');
    const s = Math.floor(msLeft / 1000);
    const parts = { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
    for (const u of ['h', 'm', 's']) {
      const span = el.querySelector(`[data-u="${u}"]`);
      const txt = U.pad(parts[u], 2);
      if (span.textContent !== txt) span.textContent = txt;
    }
  }

  NS.UI = { mount, update, setStale, setStatus, setOffline, setTimer, setMeta, setCountdown };
})(window);
