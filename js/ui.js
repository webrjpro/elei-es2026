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

    const probHead = h('div', { class: 'prob__head' },
      h('span', { class: 'prob__badge' }, 'PROBABILIDADE DE VITÓRIA'),
      h('span', { class: 'prob__tag' }, 'Análise Contínua')
    );
    const probBody = h('div', { class: 'prob__body' });
    const probBox = h('div', { class: 'prob', hidden: true }, probHead, probBody);

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
      probBox,
      alert,
      list,
      h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      chartWrap,
      h('dl', { class: 'stats' }, sComp.node, sAbst.node, sBran.node, sNulo.node));

    return {
      race, el, list, pctEl, countEl, bar, updated, finalBadge, alert, chartWrap, chartSvg, probBox, probBody,
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
    renderProbability(p, data, history);

    p.stats.comp.textContent = counting ? U.fmtPct(data.comparecimentoPct) : '—';
    p.stats.abst.textContent = counting ? U.fmtPct(data.abstencaoPct) : '—';
    p.stats.bran.textContent = counting ? U.fmtPct(data.brancosPct) : '—';
    p.stats.nulo.textContent = counting ? U.fmtPct(data.nulosPct) : '—';

    renderChart(p, counting ? history : null, list);
    p.last = data;
  }

  function renderProbability(p, data, history) {
    const prob = U.calcProbability(p.race, data, history);
    if (!prob || !prob.disponivel) {
      p.probBox.hidden = true;
      return;
    }

    p.probBox.hidden = false;
    p.probBody.textContent = '';

    if (prob.tipo === 'turnos') {
      const barT1 = h('div', { class: 'prob-bar prob-bar--t1' },
        h('div', { class: 'prob-bar__info' },
          h('span', { class: 'prob-bar__label' }, '1º Turno (Vitória Direta)'),
          h('strong', { class: 'prob-bar__val color-t1' }, `${U.fmtPctPlain(prob.probTurno1)}%`)
        ),
        h('div', { class: 'prob-bar__track' },
          h('span', { class: 'prob-bar__fill fill-t1', style: `width: ${prob.probTurno1}%` })
        )
      );

      const barT2 = h('div', { class: 'prob-bar prob-bar--t2' },
        h('div', { class: 'prob-bar__info' },
          h('span', { class: 'prob-bar__label' }, '2º Turno (Confronto)'),
          h('strong', { class: 'prob-bar__val color-t2' }, `${U.fmtPctPlain(prob.probTurno2)}%`)
        ),
        h('div', { class: 'prob-bar__track' },
          h('span', { class: 'prob-bar__fill fill-t2', style: `width: ${prob.probTurno2}%` })
        )
      );

      const proj = h('p', { class: 'prob__proj' }, prob.projecao);
      const det = h('p', { class: 'prob__det' }, prob.detalhe);

      p.probBody.appendChild(h('div', { class: 'prob__bars' }, barT1, barT2));
      p.probBody.appendChild(proj);
      p.probBody.appendChild(det);
    } else if (prob.tipo === 'senador') {
      const listEl = h('div', { class: 'prob__sen-list' });
      prob.candidatos.forEach((cand, idx) => {
        const item = h('div', { class: `prob__sen-item ${idx < 2 ? 'is-in' : 'is-out'}` },
          h('span', { class: 'prob__sen-name' }, `${cand.nome}`),
          h('div', { class: 'prob__sen-track' },
            h('span', { class: 'prob__sen-fill', style: `width: ${cand.prob}%` })
          ),
          h('strong', { class: 'prob__sen-pct' }, `${U.fmtPctPlain(cand.prob)}% vaga`)
        );
        listEl.appendChild(item);
      });

      const proj = h('p', { class: 'prob__proj' }, prob.projecao);
      const det = h('p', { class: 'prob__det' }, prob.detalhe);

      p.probBody.appendChild(listEl);
      p.probBody.appendChild(proj);
      p.probBody.appendChild(det);
    }
  }

  function renderMacroSection(macro) {
    const el = document.querySelector('#macro-section');
    if (!el || !macro) return;
    el.hidden = false;

    // 1. Governadores: PL vs PT
    const govPl = macro.gov.pl.total;
    const govPt = macro.gov.pt.total;
    const govOutros = macro.gov.outros.total;
    const govTotal = macro.gov.total;

    const govCard = el.querySelector('#card-macro-gov');
    if (govCard) {
      govCard.innerHTML = '';
      govCard.appendChild(h('div', { class: 'macro-card__head' },
        h('h3', null, 'Governadores: PL vs PT'),
        h('span', { class: 'macro-card__total' }, '27 Estados')
      ));

      const barsGov = h('div', { class: 'macro-bars' },
        h('div', { class: 'macro-bar' },
          h('div', { class: 'macro-bar__label' }, h('span', null, 'PL'), h('strong', { class: 'color-pl' }, `${govPl} estados (${U.fmtPctPlain((govPl/govTotal)*100)}%)`)),
          h('div', { class: 'macro-bar__track' }, h('span', { class: 'macro-bar__fill fill-pl', style: `width: ${(govPl/govTotal)*100}%` }))
        ),
        h('div', { class: 'macro-bar' },
          h('div', { class: 'macro-bar__label' }, h('span', null, 'PT'), h('strong', { class: 'color-pt' }, `${govPt} estados (${U.fmtPctPlain((govPt/govTotal)*100)}%)`)),
          h('div', { class: 'macro-bar__track' }, h('span', { class: 'macro-bar__fill fill-pt', style: `width: ${(govPt/govTotal)*100}%` }))
        ),
        h('div', { class: 'macro-bar' },
          h('div', { class: 'macro-bar__label' }, h('span', null, 'Outros Partidos'), h('strong', null, `${govOutros} estados (${U.fmtPctPlain((govOutros/govTotal)*100)}%)`)),
          h('div', { class: 'macro-bar__track' }, h('span', { class: 'macro-bar__fill fill-outros', style: `width: ${(govOutros/govTotal)*100}%` }))
        )
      );

      const listGov = h('div', { class: 'macro-chips' },
        h('div', { class: 'macro-chip macro-chip--pl' }, h('span', null, 'Lideranças PL: '), h('strong', null, macro.gov.pl.ufs.map(u => u.uf).join(', ') || 'Nenhum')),
        h('div', { class: 'macro-chip macro-chip--pt' }, h('span', null, 'Lideranças PT: '), h('strong', null, macro.gov.pt.ufs.map(u => u.uf).join(', ') || 'Nenhum'))
      );

      govCard.appendChild(barsGov);
      govCard.appendChild(listGov);
    }

    // 2. Senado Federal: PL vs PT (54 Vagas)
    const senPl = macro.sen.pl.total;
    const senPt = macro.sen.pt.total;
    const senOutros = macro.sen.outros.total;
    const senTotal = macro.sen.total;

    const senCard = el.querySelector('#card-macro-sen');
    if (senCard) {
      senCard.innerHTML = '';
      senCard.appendChild(h('div', { class: 'macro-card__head' },
        h('h3', null, 'Senado Federal: PL vs PT'),
        h('span', { class: 'macro-card__total' }, '54 Vagas em Disputa')
      ));

      const barsSen = h('div', { class: 'macro-bars' },
        h('div', { class: 'macro-bar' },
          h('div', { class: 'macro-bar__label' }, h('span', null, 'PL'), h('strong', { class: 'color-pl' }, `${senPl} cadeiras (${U.fmtPctPlain((senPl/senTotal)*100)}%)`)),
          h('div', { class: 'macro-bar__track' }, h('span', { class: 'macro-bar__fill fill-pl', style: `width: ${(senPl/senTotal)*100}%` }))
        ),
        h('div', { class: 'macro-bar' },
          h('div', { class: 'macro-bar__label' }, h('span', null, 'PT'), h('strong', { class: 'color-pt' }, `${senPt} cadeiras (${U.fmtPctPlain((senPt/senTotal)*100)}%)`)),
          h('div', { class: 'macro-bar__track' }, h('span', { class: 'macro-bar__fill fill-pt', style: `width: ${(senPt/senTotal)*100}%` }))
        ),
        h('div', { class: 'macro-bar' },
          h('div', { class: 'macro-bar__label' }, h('span', null, 'Outros Partidos'), h('strong', null, `${senOutros} cadeiras (${U.fmtPctPlain((senOutros/senTotal)*100)}%)`)),
          h('div', { class: 'macro-bar__track' }, h('span', { class: 'macro-bar__fill fill-outros', style: `width: ${(senOutros/senTotal)*100}%` }))
        )
      );

      const saldo = senPl - senPt;
      const saldotxt = saldo >= 0 ? `Saldo: PL lidera com +${saldo} cadeiras à frente do PT` : `Saldo: PT lidera com +${Math.abs(saldo)} cadeiras à frente do PL`;
      const noteSen = h('p', { class: 'macro-note' }, saldotxt);

      senCard.appendChild(barsSen);
      senCard.appendChild(noteSen);
    }

    // 3. Domínio Ideológico Nacional: Direita x Centro x Esquerda
    const ideolCard = el.querySelector('#card-macro-ideology');
    if (ideolCard) {
      ideolCard.innerHTML = '';
      ideolCard.appendChild(h('div', { class: 'macro-card__head' },
        h('h3', null, 'Domínio Ideológico Nacional'),
        h('span', { class: 'macro-card__total' }, 'Direita · Centro · Esquerda')
      ));

      const govDir = macro.gov.ideologia.direita;
      const govCen = macro.gov.ideologia.centro;
      const govEsq = macro.gov.ideologia.esquerda;

      const senDir = macro.sen.ideologia.direita;
      const senCen = macro.sen.ideologia.centro;
      const senEsq = macro.sen.ideologia.esquerda;

      const ideolContent = h('div', { class: 'ideol-grid' },
        h('div', { class: 'ideol-col' },
          h('h4', null, 'Governadorias (27 Estados)'),
          h('div', { class: 'ideol-stack' },
            h('span', { class: 'ideol-seg fill-dir', style: `width: ${(govDir/27)*100}%`, title: `Direita: ${govDir}` }),
            h('span', { class: 'ideol-seg fill-cen', style: `width: ${(govCen/27)*100}%`, title: `Centro: ${govCen}` }),
            h('span', { class: 'ideol-seg fill-esq', style: `width: ${(govEsq/27)*100}%`, title: `Esquerda: ${govEsq}` })
          ),
          h('div', { class: 'ideol-legend' },
            h('div', { class: 'ideol-leg-item' }, h('span', { class: 'dot dot-dir' }), `Direita: ${govDir} (${U.fmtPctPlain((govDir/27)*100)}%)`),
            h('div', { class: 'ideol-leg-item' }, h('span', { class: 'dot dot-cen' }), `Centro: ${govCen} (${U.fmtPctPlain((govCen/27)*100)}%)`),
            h('div', { class: 'ideol-leg-item' }, h('span', { class: 'dot dot-esq' }), `Esquerda: ${govEsq} (${U.fmtPctPlain((govEsq/27)*100)}%)`)
          )
        ),
        h('div', { class: 'ideol-col' },
          h('h4', null, 'Senado (54 Cadeiras em Disputa)'),
          h('div', { class: 'ideol-stack' },
            h('span', { class: 'ideol-seg fill-dir', style: `width: ${(senDir/54)*100}%`, title: `Direita: ${senDir}` }),
            h('span', { class: 'ideol-seg fill-cen', style: `width: ${(senCen/54)*100}%`, title: `Centro: ${senCen}` }),
            h('span', { class: 'ideol-seg fill-esq', style: `width: ${(senEsq/54)*100}%`, title: `Esquerda: ${senEsq}` })
          ),
          h('div', { class: 'ideol-legend' },
            h('div', { class: 'ideol-leg-item' }, h('span', { class: 'dot dot-dir' }), `Direita: ${senDir} (${U.fmtPctPlain((senDir/54)*100)}%)`),
            h('div', { class: 'ideol-leg-item' }, h('span', { class: 'dot dot-cen' }), `Centro: ${senCen} (${U.fmtPctPlain((senCen/54)*100)}%)`),
            h('div', { class: 'ideol-leg-item' }, h('span', { class: 'dot dot-esq' }), `Esquerda: ${senEsq} (${U.fmtPctPlain((senEsq/54)*100)}%)`)
          )
        )
      );

      ideolCard.appendChild(ideolContent);
    }
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

  function setCountdown(msLeft, forceHide) {
    const el = $('#countdown');
    if (!el) return;
    if (msLeft <= 0 || forceHide) {
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

  NS.UI = { mount, update, renderMacroSection, setStale, setStatus, setOffline, setTimer, setMeta, setCountdown };
})(window);
