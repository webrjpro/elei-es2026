/*!
 * Apuração 2026 — módulo de agregação nacional (PL vs PT & Domínio Ideológico).
 * Analisa os 27 estados para Governador e Senador diretamente dos dados oficiais do TSE.
 */
(function (global) {
  'use strict';

  const NS = (global.Apuracao = global.Apuracao || {});
  const { U, TSE, createStore } = NS;
  const C = global.APURACAO_CONFIG;

  const store = createStore ? createStore('macro') : { get: () => null, set: () => {} };

  const UFS = [
    'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go',
    'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi',
    'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to'
  ];

  const DIREITA_PARTIDOS = new Set(['PL', 'REPUBLICANOS', 'PP', 'UNIÃO', 'UNIAO', 'NOVO', 'PODE', 'PRD', 'DC', 'MOBILIZA', 'AGIR']);
  const CENTRO_PARTIDOS = new Set(['PSD', 'MDB', 'PSDB', 'CIDADANIA', 'SOLIDARIEDADE', 'AVANTE']);
  const ESQUERDA_PARTIDOS = new Set(['PT', 'PSB', 'PDT', 'PSOL', 'REDE', 'PC DO B', 'PCDOB', 'PV', 'UP', 'PCB', 'PSTU', 'PCO']);

  function classificarIdeologia(sigla) {
    const s = String(sigla || '').trim().toUpperCase();
    if (DIREITA_PARTIDOS.has(s)) return 'DIREITA';
    if (CENTRO_PARTIDOS.has(s)) return 'CENTRO';
    if (ESQUERDA_PARTIDOS.has(s)) return 'ESQUERDA';
    return 'CENTRO';
  }

  let cacheMacro = store.get('macro_data') || null;
  let cacheTimestamp = cacheMacro && cacheMacro.ts ? cacheMacro.ts : 0;
  const CACHE_TTL_MS = 25000; // 25s

  function getCachedMacro() {
    return cacheMacro;
  }

  async function fetchUf(uf, cargo) {
    const eleicao = '6259'; // Eleição Estadual 1º turno
    const url = `${C.base}/${C.ciclo}/${eleicao}/dados/${uf}/${uf}-c${U.pad(cargo, 4)}-e${U.pad(eleicao, 6)}-u.json`;
    const targetUrl = C.proxy ? C.proxy + encodeURIComponent(url) : url;
    const res = await fetch(targetUrl, { cache: 'no-cache', credentials: 'omit', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function mapConcurrent(items, fn, limit = 6) {
    const results = new Array(items.length);
    let index = 0;
    const worker = async () => {
      while (index < items.length) {
        const i = index++;
        try {
          results[i] = await fn(items[i], i);
        } catch (_) {
          results[i] = null;
        }
      }
    };
    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  function extrairCandidatos(raw) {
    if (!raw || !Array.isArray(raw.carg) || !raw.carg[0]) return [];
    const carg = raw.carg[0];
    const cands = [];
    for (const agr of carg.agr || []) {
      for (const par of agr.par || []) {
        for (const c of par.cand || []) {
          cands.push({
            nome: String(c.nmu || c.nm || '—'),
            partido: String(par.sg || '').toUpperCase(),
            votos: U.int(c.vap),
            pct: U.num(c.pvapn !== undefined && c.pvapn !== '' ? c.pvapn : c.pvap)
          });
        }
      }
    }
    return cands.sort((a, b) => b.votos - a.votos || b.pct - a.pct);
  }

  async function loadMacro() {
    const now = Date.now();
    if (cacheMacro && now - cacheTimestamp < CACHE_TTL_MS) {
      return cacheMacro;
    }

    const [govRawList, senRawList] = await Promise.all([
      mapConcurrent(UFS, (uf) => fetchUf(uf, 3), 6),
      mapConcurrent(UFS, (uf) => fetchUf(uf, 5), 6)
    ]);

    const govStats = {
      total: 27,
      pl: { total: 0, ufs: [] },
      pt: { total: 0, ufs: [] },
      outros: { total: 0, partidos: {} },
      ideologia: { direita: 0, centro: 0, esquerda: 0 }
    };

    const senStats = {
      total: 54, // 2 vagas por UF
      pl: { total: 0, ufs: [] },
      pt: { total: 0, ufs: [] },
      outros: { total: 0, partidos: {} },
      ideologia: { direita: 0, centro: 0, esquerda: 0 }
    };

    // Processa Governadores (27 estados)
    govRawList.forEach((raw, i) => {
      const uf = UFS[i].toUpperCase();
      const cands = extrairCandidatos(raw);
      if (!cands.length) return;
      const lider = cands[0];
      const part = lider.partido;
      const ideo = classificarIdeologia(part);

      govStats.ideologia[ideo.toLowerCase()]++;

      if (part === 'PL') {
        govStats.pl.total++;
        govStats.pl.ufs.push({ uf, nome: lider.nome, pct: lider.pct });
      } else if (part === 'PT') {
        govStats.pt.total++;
        govStats.pt.ufs.push({ uf, nome: lider.nome, pct: lider.pct });
      } else {
        govStats.outros.total++;
        govStats.outros.partidos[part] = (govStats.outros.partidos[part] || 0) + 1;
      }
    });

    // Processa Senadores (54 vagas = top 2 por UF)
    senRawList.forEach((raw, i) => {
      const uf = UFS[i].toUpperCase();
      const cands = extrairCandidatos(raw);
      if (!cands.length) return;
      const top2 = cands.slice(0, 2);

      top2.forEach((cand) => {
        const part = cand.partido;
        const ideo = classificarIdeologia(part);

        senStats.ideologia[ideo.toLowerCase()]++;

        if (part === 'PL') {
          senStats.pl.total++;
          senStats.pl.ufs.push({ uf, nome: cand.nome, pct: cand.pct });
        } else if (part === 'PT') {
          senStats.pt.total++;
          senStats.pt.ufs.push({ uf, nome: cand.nome, pct: cand.pct });
        } else {
          senStats.outros.total++;
          senStats.outros.partidos[part] = (senStats.outros.partidos[part] || 0) + 1;
        }
      });
    });

    cacheMacro = {
      gov: govStats,
      sen: senStats,
      ts: now
    };
    cacheTimestamp = now;
    store.set('macro_data', cacheMacro);
    return cacheMacro;
  }

  NS.Macro = { loadMacro, getCachedMacro, classificarIdeologia };
})(window);
