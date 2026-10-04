/*!
 * Apuração 2026 — orquestração: ciclo de consulta, resiliência e estado.
 *
 * Garantias:
 *  • Nunca zera a tela: o último dado oficial válido fica visível (memória + localStorage).
 *  • Rejeita arquivos com estrutura inválida e dados mais antigos que o já exibido
 *    (proteção contra nó de CDN desatualizado).
 *  • Backoff exponencial em falhas, pausa com a aba oculta, retomada imediata ao voltar/online.
 *  • 404 → aguarda 5 min antes de tentar de novo (o TSE bloqueia IPs com muitos 404).
 */
(function (global) {
  'use strict';

  const C = global.APURACAO_CONFIG;
  const NS = global.Apuracao;
  if (!C || !NS || !NS.UI || !NS.TSE) {
    document.body.classList.add('is-broken');
    return;
  }
  const { U, TSE, UI, createStore } = NS;

  const START = Date.parse(C.inicioDivulgacao) || 0;
  const store = createStore('oficial');
  const HISTORY_MAX = 400;

  const state = {
    races: new Map(),
    timer: 0,
    lastPollAt: 0,
    nextAt: 0,
    inflight: false,
    allFailStreak: 0,
    via: 'tse'
  };

  /* ------------------------------------------------------------ Init */

  function init() {
    const brand = document.querySelector('#turno-label');
    if (brand && C.rotuloTurno) brand.textContent = C.rotuloTurno;

    UI.mount(document.querySelector('#races'), C.corridas);
    if (NS.Territory) NS.Territory.mount(document.querySelector('#territorial-charts'));

    for (const race of C.corridas) {
      const rs = {
        race,
        last: store.get(`last:${race.id}`),
        history: store.get(`hist:${race.id}`) || [],
        failCount: 0,
        olderCount: 0,
        blockedUntil: 0,
        ok: false
      };
      if (!Array.isArray(rs.history)) rs.history = [];
      state.races.set(race.id, rs);
      // Exibe imediatamente o último dado conhecido (carregamento instantâneo e resiliência offline).
      if (rs.last && Array.isArray(rs.last.candidatos)) {
        UI.update(race.id, rs.last, null, rs.history);
        if (NS.Territory) NS.Territory.updateRace(race, rs.last, true);
      }
      else rs.last = null;
    }

    if (NS.Macro && typeof NS.Macro.getCachedMacro === 'function') {
      const cached = NS.Macro.getCachedMacro();
      if (cached && UI.renderMacroSection) UI.renderMacroSection(cached);
    }

    UI.setStatus('idle', 'Conectando…');
    bindEvents();
    tick();
    setInterval(tick, 250);
    poll();
  }

  /* ----------------------------------------------------------- Ciclo */

  function baseInterval() {
    return Date.now() < START - 5 * 60000 ? C.intervaloPreMs : C.intervaloMs;
  }

  function schedule() {
    clearTimeout(state.timer);
    let ms = baseInterval();
    if (state.allFailStreak > 0) ms = Math.min(C.intervaloMaxMs, ms * Math.pow(2, Math.min(state.allFailStreak, 4)));
    ms = Math.round(ms * (0.9 + Math.random() * 0.2)); // jitter: evita sincronizar milhares de visitantes
    state.nextAt = Date.now() + ms;
    if (document.visibilityState !== 'hidden') state.timer = setTimeout(poll, ms);
  }

  async function poll() {
    if (state.inflight) return;
    state.inflight = true;
    clearTimeout(state.timer);
    state.lastPollAt = Date.now();
    try {
      const results = await Promise.all(C.corridas.map((race) => pollRace(state.races.get(race.id))));
      updateGlobalStatus(results);
      if (NS.Macro && typeof NS.Macro.loadMacro === 'function') {
        NS.Macro.loadMacro().then((macro) => {
          if (macro && UI.renderMacroSection) UI.renderMacroSection(macro);
        }).catch((err) => console.warn('[apuração] macro:', err));
      }
    } catch (err) {
      console.error('[apuração] erro inesperado no ciclo', err);
    } finally {
      state.inflight = false;
      schedule();
    }
  }

  async function pollRace(rs) {
    const { race } = rs;
    if (Date.now() < rs.blockedUntil) return rs.ok;
    try {
      const { raw, via } = await TSE.load(race);
      state.via = via;
      let data = TSE.normalize(raw, race);
      apply(rs, data);
      rs.failCount = 0;
      rs.ok = true;
      UI.setStale(race.id, false);
      if (NS.Territory && rs.last) NS.Territory.updateRace(race, rs.last, false);
      return true;
    } catch (err) {
      rs.failCount++;
      rs.ok = false;
      if (NS.Territory && rs.last) NS.Territory.updateRace(race, rs.last, true);
      if (err && err.status === 404) rs.blockedUntil = Date.now() + 5 * 60000;
      console.warn(`[apuração] ${race.id}:`, err && err.message ? err.message : err);
      if (rs.last && rs.failCount >= 2) {
        UI.setStale(race.id, true, `Exibindo o último dado oficial recebido (${rs.last.hg}). Tentando obter novos dados…`);
      }
      return false;
    }
  }

  function apply(rs, data) {
    const last = rs.last;

    // Proteção contra regressão (nó de CDN com cópia antiga). Após 5 leituras seguidas, aceita:
    // significa que a fonte realmente mudou (ex.: correção oficial).
    if (last && last.ts && data.ts && data.ts < last.ts) {
      rs.olderCount++;
      if (rs.olderCount < 5) return;
    }
    rs.olderCount = 0;

    // Só verifica a vitória depois de uma leitura oficial válida e aceita.
    // O cache local, a liderança e resultados estaduais não acionam a celebração.
    if (NS.Victory && (!last || !last.ts || data.ts >= last.ts)) NS.Victory.sync(rs.race, data);

    if (last && last.idg === data.idg && last.ts === data.ts) return; // nada mudou

    if (data.contando) pushHistory(rs, data);
    rs.last = data;
    store.set(`last:${rs.race.id}`, data);
    UI.update(rs.race.id, data, last, rs.history);
    if (NS.Territory) NS.Territory.updateRace(rs.race, data);
  }

  function pushHistory(rs, data) {
    const snap = { ts: data.ts, x: Math.round(data.secoes.pct * 1000) / 1000, c: {} };
    for (const c of data.candidatos) snap.c[c.sq] = Math.round(c.pct * 1000) / 1000;
    const h = rs.history;
    // Se a apuração "voltou" (reprocessamento), descarta pontos à frente.
    while (h.length && h[h.length - 1].x > snap.x) h.pop();
    const prev = h[h.length - 1];
    if (prev && prev.x === snap.x) h[h.length - 1] = snap;
    else h.push(snap);
    if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
    store.set(`hist:${rs.race.id}`, h);
  }

  function updateGlobalStatus(results) {
    const okCount = results.filter(Boolean).length;
    const all = Array.from(state.races.values());
    const now = Date.now();

    if (okCount === 0) state.allFailStreak++;
    else state.allFailStreak = 0;

    if (okCount === 0) {
      const latest = all.map((r) => r.last).filter(Boolean).sort((a, b) => b.ts - a.ts)[0];
      UI.setOffline(true, latest ? `${latest.hg}` : 'nenhum dado ainda');
      UI.setStatus('offline', 'Sem conexão');
    } else {
      UI.setOffline(false);
      if (okCount < results.length) UI.setStatus('unstable', 'Conexão instável');
      else if (all.every((r) => r.last && r.last.finalizada)) UI.setStatus('final', 'Totalização finalizada');
      else if (now < START && !all.some((r) => r.last && r.last.contando)) UI.setStatus('waiting', 'Aguardando início');
      else UI.setStatus('live', 'Ao vivo');
    }

    const viaTxt = state.via === 'proxy' ? 'cache próprio (proxy)' : 'TSE (direto)';
    UI.setMeta(`Última verificação: ${U.brTime(now)} · Fonte oficial: ${viaTxt}`);
  }

  /* ----------------------------------------------- Relógio e eventos */

  let countdownWasActive = null;

  function tick() {
    const now = Date.now();
    const left = START - now;
    UI.setCountdown(left);

    const active = left > 0;
    if (countdownWasActive === true && !active) poll(); // 17h: entra no modo apuração na hora
    countdownWasActive = active;

    const span = state.nextAt - state.lastPollAt;
    UI.setTimer(state.inflight || span <= 0 ? 1 : (now - state.lastPollAt) / span);
  }

  function bindEvents() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearTimeout(state.timer);
      else if (Date.now() >= state.nextAt - 1000) poll();
      else schedule();
    });
    global.addEventListener('online', () => poll());
    global.addEventListener('offline', () => UI.setStatus('offline', 'Sem conexão'));

    const btn = document.querySelector('#refresh');
    if (btn) {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('is-spinning');
        poll().finally(() => setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove('is-spinning');
        }, 4000));
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
