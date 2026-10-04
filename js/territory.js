/* Gráficos territoriais: exclusivamente arquivos oficiais do TSE. */
(function (global) {
  'use strict';
  const NS = global.Apuracao;
  const C = global.APURACAO_CONFIG;
  const { U, TSE, createStore } = NS;
  const h = U.h;
  const STATES = [
    ['ac', 'Acre'], ['al', 'Alagoas'], ['ap', 'Amapá'], ['am', 'Amazonas'],
    ['ba', 'Bahia'], ['ce', 'Ceará'], ['df', 'Distrito Federal'], ['es', 'Espírito Santo'],
    ['go', 'Goiás'], ['ma', 'Maranhão'], ['mt', 'Mato Grosso'], ['ms', 'Mato Grosso do Sul'],
    ['mg', 'Minas Gerais'], ['pa', 'Pará'], ['pb', 'Paraíba'], ['pr', 'Paraná'],
    ['pe', 'Pernambuco'], ['pi', 'Piauí'], ['rj', 'Rio de Janeiro'], ['rn', 'Rio Grande do Norte'],
    ['rs', 'Rio Grande do Sul'], ['ro', 'Rondônia'], ['rr', 'Roraima'], ['sc', 'Santa Catarina'],
    ['sp', 'São Paulo'], ['se', 'Sergipe'], ['to', 'Tocantins']
  ];
  const COLORS = ['#4f8cff', '#ff5d73', '#21c79b', '#f5b83d', '#a77bff', '#26c6e8'];
  const REGIONS = [
    { id: 'norte', name: 'Norte', ufs: ['ac', 'ap', 'am', 'pa', 'ro', 'rr', 'to'] },
    { id: 'nordeste', name: 'Nordeste', ufs: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'] },
    { id: 'centro-oeste', name: 'Centro-Oeste', ufs: ['df', 'go', 'mt', 'ms'] },
    { id: 'sudeste', name: 'Sudeste', ufs: ['es', 'mg', 'rj', 'sp'] },
    { id: 'sul', name: 'Sul', ufs: ['pr', 'rs', 'sc'] }
  ];
  const store = createStore('territorial');
  const entries = new Map();
  const rio = new Map();
  let grid, summary, filter, region, order, timer, busy = false, mounted = false;

  function section(title, subtitle, id) {
    return h('section', { class: 'territory-section', 'aria-labelledby': id },
      h('header', { class: 'territory-section__head' },
        h('div', null, h('p', { class: 'race__eyebrow' }, 'Apuração por local · Fonte: TSE'),
          h('h2', { id }, title), h('p', { class: 'territory-section__subtitle' }, subtitle))));
  }

  function card(title, race) {
    const pct = h('strong', { title: 'Percentual de seções totalizadas' }, '—');
    const progress = h('div', { class: 'territory-card__track', role: 'progressbar',
      'aria-label': `Seções totalizadas · ${title}`, 'aria-valuemin': 0, 'aria-valuemax': 100 });
    const fill = h('span');
    progress.appendChild(fill);
    const count = h('p', { class: 'territory-card__count' }, 'Seções totalizadas: aguardando dados oficiais');
    const rows = h('ol', { class: 'territory-bars', 'aria-label': `Votos válidos · ${title}` });
    const updated = h('p', { class: 'territory-card__updated' });
    const status = h('p', { class: 'territory-card__status', role: 'status' }, 'Consultando o TSE…');
    const source = h('a', { href: TSE.resultUrl(race), target: '_blank', rel: 'noopener noreferrer',
      class: 'territory-card__source' }, 'Arquivo oficial do TSE ↗');
    const el = h('article', { class: 'territory-card' },
      h('div', { class: 'territory-card__head' }, h('h3', null, title), pct),
      progress, count, rows, status, updated, source);
    return { el, race, pct, progress, fill, count, rows, status, updated, last: null, blockedUntil: 0, failures: 0, ok: false };
  }

  function render(entry, data, stale) {
    entry.last = data;
    entry.pct.textContent = U.fmtPct(data.secoes.pct);
    entry.progress.setAttribute('aria-valuenow', data.secoes.pct);
    entry.fill.style.width = `${data.secoes.pct}%`;
    entry.count.textContent = `${U.fmtInt(data.secoes.totalizadas)} de ${U.fmtInt(data.secoes.total)} seções totalizadas`;
    entry.updated.textContent = `TSE · ${data.dg} ${data.hg} · horário de Brasília`;
    entry.el.classList.toggle('is-stale', !!stale);
    entry.status.textContent = stale ? 'Último dado oficial salvo. Aguardando atualização do TSE…'
      : data.finalizada ? 'Totalização finalizada' : data.contando ? '' : 'Aguardando início da apuração';
    entry.status.hidden = !entry.status.textContent;
    entry.rows.replaceChildren();
    const colors = new Map(data.candidatos.slice().sort((a, b) => Number(a.numero) - Number(b.numero))
      .map((c, i) => [c.sq, COLORS[i % COLORS.length]]));
    const candidates = data.candidatos.slice().sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
    const visible = entry.showAll ? candidates : candidates.slice(0, 3);
    // As disputas do RJ exibem todos os candidatos; nos estados, os três mais votados.
    for (const c of visible) {
      const bar = h('span', { class: 'territory-bar__fill' });
      bar.style.width = `${U.clamp(c.pct, 0, 100)}%`;
      bar.style.backgroundColor = colors.get(c.sq);
      entry.rows.appendChild(h('li', { class: 'territory-bar' },
        h('div', { class: 'territory-bar__label' }, h('span', null, `${c.nome} · ${c.partido} ${c.numero}`),
          h('strong', null, data.contando ? U.fmtPct(c.pct) : '—')),
        h('div', { class: 'territory-bar__track', 'aria-hidden': true }, bar),
        h('small', null, data.contando ? `${U.fmtInt(c.votos)} votos` : 'Aguardando votos oficiais')));
    }
  }

  function applyFilters() {
    const sorted = [...entries.entries()].sort((a, b) => order.value === 'apuracao'
      ? (b[1].last ? b[1].last.secoes.pct : -1) - (a[1].last ? a[1].last.secoes.pct : -1)
      : a[1].name.localeCompare(b[1].name, 'pt-BR'));
    for (const [uf, entry] of sorted) {
      entry.el.hidden = (filter.value !== 'todos' && filter.value !== uf) ||
        (region.value !== 'todas' && region.value !== entry.region);
      grid.appendChild(entry.el);
    }
  }

  function updateStateOptions() {
    const selected = filter.value;
    const available = [...entries.entries()].filter(([, entry]) => region.value === 'todas' || entry.region === region.value);
    filter.replaceChildren(h('option', { value: 'todos' }, region.value === 'todas'
      ? 'Todos os estados e DF' : 'Todas as UFs da região'));
    available.forEach(([uf, entry]) => filter.appendChild(h('option', { value: uf }, entry.name)));
    filter.value = available.some(([uf]) => uf === selected) ? selected : 'todos';
  }

  function updateSummary() {
    if (!summary) return;
    const received = [...entries.values()].filter(e => e.last).length;
    const current = [...entries.values()].filter(e => e.ok).length;
    summary.textContent = `${received} de 27 UFs com dados oficiais recebidos · ${current} atualizadas nesta consulta`;
    applyFilters();
  }

  function validCache(data, race) {
    return data && data.id === race.id && data.secoes && Array.isArray(data.candidatos) &&
      data.candidatos.length && Number.isFinite(data.secoes.pct);
  }

  async function pollEntry(entry) {
    if (Date.now() < entry.blockedUntil) return;
    try {
      const { raw } = await TSE.load(entry.race);
      const data = TSE.normalize(raw, entry.race);
      if (entry.last && entry.last.ts && (!data.ts || data.ts < entry.last.ts)) {
        throw new Error('Arquivo anterior ao último dado oficial recebido');
      }
      render(entry, data, false);
      store.set(`${C.ciclo}:${entry.race.eleicao}:${entry.race.id}`, data);
      entry.ok = true;
      entry.failures = 0;
    } catch (error) {
      entry.ok = false;
      entry.failures++;
      const delay = error.status === 404 ? 300000
        : Math.min(300000, (C.intervaloTerritorialMs || 60000) * Math.pow(2, Math.min(entry.failures - 1, 3)));
      entry.blockedUntil = Date.now() + delay;
      if (entry.last) render(entry, entry.last, true);
      else entry.status.textContent = error.status === 404
        ? 'Arquivo ainda não disponibilizado pelo TSE. Nova consulta automática.'
        : 'Dados oficiais indisponíveis. Tentando novamente…';
    }
  }

  async function refresh() {
    if (busy || !mounted || document.visibilityState === 'hidden') return;
    busy = true;
    clearTimeout(timer);
    const queue = [...entries.values()];
    try {
      // Quatro conexões no máximo; não consulta municípios nem dados de terceiros.
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length && document.visibilityState !== 'hidden') {
          await pollEntry(queue.shift());
        }
      }));
      updateSummary();
    } finally {
      busy = false;
      if (document.visibilityState !== 'hidden') timer = setTimeout(refresh, C.intervaloTerritorialMs || 60000);
    }
  }

  function mount(container) {
    if (!container || mounted) return;
    mounted = true;
    const president = C.corridas.find(r => r.id === 'presidente');
    if (president) {
      const br = section('Presidente · apuração por estado', '26 estados e Distrito Federal. Barras: votos válidos dos três mais votados em cada UF.', 'territory-br-title');
      region = h('select', { id: 'territory-region' }, h('option', { value: 'todas' }, 'Todas as regiões'),
        ...REGIONS.map(r => h('option', { value: r.id }, r.name)));
      filter = h('select', { id: 'territory-state' }, h('option', { value: 'todos' }, 'Todos os estados e DF'));
      order = h('select', { id: 'territory-order' }, h('option', { value: 'nome' }, 'Nome do estado'),
        h('option', { value: 'apuracao' }, 'Maior percentual apurado'));
      summary = h('p', { class: 'territory-summary', role: 'status' }, 'Consultando os arquivos oficiais das 27 UFs…');
      grid = h('div', { class: 'territory-grid' });
      for (const [uf, name] of STATES) {
        const race = { ...president, id: `presidente-${uf}`, uf };
        const entry = card(`${name} · ${uf.toUpperCase()}`, race);
        entry.name = name;
        entry.region = REGIONS.find(r => r.ufs.includes(uf)).id;
        entries.set(uf, entry);
        filter.appendChild(h('option', { value: uf }, name));
        grid.appendChild(entry.el);
        const saved = store.get(`${C.ciclo}:${race.eleicao}:${race.id}`);
        if (validCache(saved, race)) render(entry, saved, true);
      }
      br.append(h('div', { class: 'territory-controls' },
        h('label', { for: 'territory-region' }, 'Região', region),
        h('label', { for: 'territory-state' }, 'Estado', filter),
        h('label', { for: 'territory-order' }, 'Ordenar por', order)), summary,
        h('p', { class: 'territory-section__subtitle' }, 'Seções totalizadas indicam o avanço da apuração informado pelo TSE. Dados de cada UF podem ter horários diferentes.'), grid);
      container.appendChild(br);
      filter.addEventListener('change', applyFilters);
      region.addEventListener('change', () => { updateStateOptions(); applyFilters(); });
      order.addEventListener('change', applyFilters);
      applyFilters();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearTimeout(timer);
      else refresh();
    });
    global.addEventListener('online', refresh);
    const button = document.querySelector('#refresh');
    if (button) button.addEventListener('click', refresh);
    if (president) refresh();
  }

  function updateRace(race, data, stale) {
    /* Mantido para compatibilidade sem duplicar os cards do RJ */
  }

  NS.Territory = { mount, refresh, updateRace };
})(window);
