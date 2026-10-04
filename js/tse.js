/*!
 * Apuração 2026 — camada de dados do TSE.
 * Leiaute: arquivo de resultado unificado (EA20, sufixo "-u.json"), diretório "dados/<uf>".
 */
(function (global) {
  'use strict';

  const NS = global.Apuracao;
  const { U } = NS;
  const C = global.APURACAO_CONFIG;

  class TseError extends Error {
    constructor(message, extra) {
      super(message);
      this.name = 'TseError';
      Object.assign(this, extra);
    }
  }

  /* ---------------------------------------------------------------- URLs */

  function resultUrl(race) {
    return `${C.base}/${C.ciclo}/${race.eleicao}/dados/${race.uf}/` +
      `${race.uf}-c${U.pad(race.cargo, 4)}-e${U.pad(race.eleicao, 6)}-u.json`;
  }

  function photoUrl(race, sqcand) {
    return `${C.base}/${C.ciclo}/${race.eleicao}/fotos/${race.uf}/${encodeURIComponent(sqcand)}.jpeg`;
  }

  /* ------------------------------------------------------------- Fetch */

  async function fetchJson(url) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), C.timeoutMs) : null;
    try {
      // "no-cache" = revalida com ETag/Last-Modified: só baixa o corpo se o arquivo mudou (HTTP 304).
      const res = await fetch(url, {
        cache: 'no-cache',
        credentials: 'omit',
        mode: 'cors',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw new TseError(`HTTP ${res.status}`, { status: res.status });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new TseError('JSON inválido', { invalid: true });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') throw new TseError('Tempo esgotado', { timeout: true });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function load(race) {
    const url = resultUrl(race);
    const viaProxy = () => fetchJson(C.proxy + encodeURIComponent(url)).then((raw) => ({ raw, via: 'proxy' }));
    const direct = () => fetchJson(url).then((raw) => ({ raw, via: 'tse' }));

    if (!C.proxy) return direct();
    const [first, second] = C.proxyPrimeiro ? [viaProxy, direct] : [direct, viaProxy];
    try {
      return await first();
    } catch (err) {
      if (err && err.status === 404) throw err; // arquivo inexistente: não insistir
      return second();
    }
  }

  /* ------------------------------------------------- Validação + modelo */

  function fail(msg) {
    throw new TseError(`Arquivo rejeitado: ${msg}`, { invalid: true });
  }

  /**
   * Valida a estrutura do JSON oficial e converte para o modelo interno.
   * Falhas estruturais → rejeita (mantém o último dado válido na tela).
   */
  function normalize(raw, race) {
    if (!raw || typeof raw !== 'object') fail('conteúdo vazio');
    if (String(raw.ele) !== String(race.eleicao)) fail(`eleição ${raw.ele} ≠ ${race.eleicao}`);
    if (String(raw.cdabr || '').toLowerCase() !== race.uf) fail(`abrangência ${raw.cdabr} ≠ ${race.uf}`);
    if (!Array.isArray(raw.carg)) fail('sem cargos');

    const carg = raw.carg.find((c) => String(c.cd) === String(race.cargo));
    if (!carg) fail(`cargo ${race.cargo} ausente`);
    if (!Array.isArray(carg.agr)) fail('sem agrupamentos');

    const s = raw.s || {};
    const e = raw.e || {};
    const v = raw.v || {};

    const candidatos = [];
    const seen = new Set();
    for (const agr of carg.agr) {
      for (const par of agr.par || []) {
        for (const c of par.cand || []) {
          if (!c || !c.sqcand || seen.has(c.sqcand)) continue;
          seen.add(c.sqcand);
          const votos = U.int(c.vap);
          const pct = U.clamp(U.num(c.pvapn !== undefined && c.pvapn !== '' ? c.pvapn : c.pvap), 0, 100);
          candidatos.push({
            sq: String(c.sqcand),
            numero: String(c.n || ''),
            nome: String(c.nmu || c.nm || '—'),
            nomeCompleto: String(c.nm || c.nmu || ''),
            partido: String(par.sg || ''),
            coligacao: agr.tp === 'c' ? String(agr.nm || '') : '',
            votos,
            pct,
            eleito: c.e === 's',
            situacao: String(c.st || ''),
            destino: String(c.dvt || ''),
            vices: (c.vs || []).map((x) => String(x.nmu || x.nm || '')).filter(Boolean)
          });
        }
      }
    }
    if (!candidatos.length) fail('nenhum candidato');

    // Checagens de consistência (não bloqueiam: apenas registram).
    const somaPct = candidatos.reduce((a, c) => a + c.pct, 0);
    if (somaPct > 100.6) console.warn(`[apuração] ${race.id}: soma de percentuais = ${somaPct.toFixed(2)}%`);

    const secoesTotal = U.int(s.ts);
    const secoesTot = U.int(s.st);
    const ts = U.tseTime(raw.dg, raw.hg);
    const votosApurados = candidatos.reduce((a, c) => a + c.votos, 0);

    return {
      id: race.id,
      ts,
      dg: String(raw.dg || ''),
      hg: String(raw.hg || ''),
      idg: String(raw.idg || ''),
      finalizada: raw.tf === 's',
      vagas: Math.max(1, U.int(carg.nv) || 1),
      contando: secoesTot > 0 || votosApurados > 0,
      secoes: {
        total: secoesTotal,
        totalizadas: secoesTot,
        pct: U.clamp(U.num(s.pstn !== undefined && s.pstn !== '' ? s.pstn : s.pst), 0, 100)
      },
      eleitores: U.int(e.te),
      comparecimentoPct: U.num(e.pcn || e.pc),
      abstencaoPct: U.num(e.pan || e.pa),
      brancosPct: U.num(v.pvbn || v.pvb),
      nulosPct: U.num(v.ptvnn || v.ptvn),
      validos: U.int(v.vv),
      candidatos
    };
  }

  NS.TSE = { resultUrl, photoUrl, load, normalize, TseError };
})(window);
