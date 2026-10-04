/*!
 * Apuração 2026 — utilitários e persistência local.
 */
(function (global) {
  'use strict';

  const NS = (global.Apuracao = global.Apuracao || {});

  const nfInt = new Intl.NumberFormat('pt-BR');
  const nfPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const U = {
    /** "48,31" | "48.31" | 48.31 → 48.31 (nunca NaN) */
    num(v) {
      if (v === null || v === undefined || v === '') return 0;
      const n = Number(String(v).trim().replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    },
    /** "52340218" → 52340218 (nunca NaN, nunca negativo) */
    int(v) {
      const n = parseInt(String(v === undefined || v === null ? '' : v).replace(/[^\d]/g, ''), 10);
      return Number.isFinite(n) ? n : 0;
    },
    pad: (v, len) => String(v).padStart(len, '0'),
    fmtInt: (n) => nfInt.format(Math.round(n)),
    fmtPct: (n) => nfPct.format(n) + '%',
    fmtPctPlain: (n) => nfPct.format(n),
    clamp: (n, a, b) => Math.min(b, Math.max(a, n)),

    /** Data/hora do TSE (sempre horário de Brasília) → epoch ms. */
    tseTime(dg, hg) {
      const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dg || '');
      const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(hg || '');
      if (!d || !t) return 0;
      const ms = Date.parse(`${d[3]}-${d[2]}-${d[1]}T${t[1]}:${t[2]}:${t[3]}-03:00`);
      return Number.isFinite(ms) ? ms : 0;
    },

    /** Hora local de Brasília para exibição (independe do fuso do visitante). */
    brTime(ms) {
      try {
        return new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
      } catch (_) {
        return new Date(ms).toLocaleTimeString('pt-BR', { hour12: false });
      }
    },

    initials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p));
      const a = (parts[0] || '?')[0] || '?';
      const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return (a + b).toUpperCase();
    },

    hash(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    },

    /**
     * Criação segura de DOM (nunca usa innerHTML → imune a XSS vindo de dados externos).
     * h('div', {class:'x', hidden:true}, 'texto', outroNode)
     */
    h(tag, attrs, ...children) {
      const el = document.createElement(tag);
      if (attrs) {
        for (const k of Object.keys(attrs)) {
          const v = attrs[k];
          if (v === false || v === null || v === undefined) continue;
          if (k === 'class') el.className = v;
          else if (k === 'text') el.textContent = v;
          else if (v === true) el.setAttribute(k, '');
          else el.setAttribute(k, String(v));
        }
      }
      for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
      return el;
    },

    svg(tag, attrs) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
      return el;
    },

    /** Função erro de Gauss (Abramowitz & Stegun). */
    erf(x) {
      const sign = x >= 0 ? 1 : -1;
      x = Math.abs(x);
      const a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
      const t = 1.0 / (1.0 + p * x);
      const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
      return sign * y;
    },

    /** Distribuição normal acumulada CDF P(X <= z). */
    normCdf(z) {
      return 0.5 * (1.0 + U.erf(z / Math.SQRT2));
    },

    /**
     * Modelo Estatístico Contínuo de Probabilidade de Vitória (1º vs 2º turno).
     * Analisa continuamente o volume de seções apuradas, os percentuais dos mais votados
     * e o drift da curva temporal histórica.
     */
    calcProbability(race, data, history) {
      if (!data || !data.contando || !Array.isArray(data.candidatos) || !data.candidatos.length) {
        return null;
      }

      const s = U.clamp(data.secoes.pct / 100, 0, 1);
      if (s < 0.005) {
        return {
          disponivel: false,
          msg: 'Aguardando apuração inicial das seções para estimativa matemática'
        };
      }

      const cands = data.candidatos.slice().sort((a, b) => b.votos - a.votos || b.pct - a.pct);
      const c0 = cands[0];
      const c1 = cands[1] || { nome: '—', pct: 0, votos: 0 };
      const c2 = cands[2] || { nome: '—', pct: 0, votos: 0 };

      // Eleição Majoritária com 2 turnos (Presidente = cargo 1, Governador = cargo 3)
      if (race.cargo === 1 || race.cargo === 3) {
        if (data.finalizada) {
          if (c0.pct > 50) {
            return {
              disponivel: true,
              tipo: 'turnos',
              probTurno1: 100,
              probTurno2: 0,
              vencedor1T: c0.nome,
              cand1: c0.nome,
              cand2: c1.nome,
              projecao: `Totalização encerrada: Vitória de ${c0.nome} em 1º Turno`,
              detalhe: `Resultado oficial finalizado com ${U.fmtPct(c0.pct)} dos votos válidos.`
            };
          } else {
            return {
              disponivel: true,
              tipo: 'turnos',
              probTurno1: 0,
              probTurno2: 100,
              cand1: c0.nome,
              cand2: c1.nome,
              projecao: `Totalização encerrada: 2º Turno entre ${c0.nome} e ${c1.nome}`,
              detalhe: 'Nenhum candidato ultrapassou 50% dos votos válidos no 1º turno.'
            };
          }
        }

        const p0 = c0.pct / 100;
        const rem = 1 - s;

        // Votos e comparecimento reais do TSE
        const totalEleitores = data.eleitores || 0;
        const compTaxa = (data.comparecimentoPct > 0 ? data.comparecimentoPct : 79.1) / 100;
        const valTaxa = Math.max(0.85, (100 - (data.brancosPct + data.nulosPct)) / 100);

        const compTotalEst = totalEleitores > 0
          ? Math.round(totalEleitores * compTaxa)
          : (data.comparecimento > 0 && s > 0 ? Math.round(data.comparecimento / s) : 0);

        const validosTotalEst = compTotalEst > 0
          ? Math.round(compTotalEst * valTaxa)
          : (data.validos > 0 && s > 0 ? Math.round(data.validos / s) : 0);

        const validosApurados = data.validos || cands.reduce((acc, cur) => acc + cur.votos, 0);
        const validosRestantes = Math.max(0, validosTotalEst - validosApurados);

        const meta50Votos = Math.floor(validosTotalEst / 2) + 1;
        const faltamParaLider50 = Math.max(0, meta50Votos - c0.votos);

        // Votos necessários nos restantes para 50%
        const reqRestante = validosRestantes > 0
          ? (faltamParaLider50 / validosRestantes)
          : (rem > 0.0001 ? (0.50 - s * p0) / rem : (p0 >= 0.50 ? 0 : 1));

        // Drift histórico (análise da inclinação nas últimas leituras do gráfico)
        let drift = 0;
        if (Array.isArray(history) && history.length >= 2) {
          const older = history[Math.max(0, history.length - 8)];
          const ds = s - (older.x / 100);
          if (ds >= 0.02 && older.c && older.c[c0.sq] !== undefined) {
            const dp = p0 - (older.c[c0.sq] / 100);
            drift = U.clamp(dp / ds, -0.15, 0.15);
          }
        }

        const muRest = U.clamp(p0 + drift * rem * 0.4, 0, 1);
        const muFinal = s * p0 + rem * muRest;
        const sigma0 = 0.13;
        const sigmaFinal = Math.max(0.002, sigma0 * Math.sqrt(s * rem));

        const z = (muFinal - 0.50) / sigmaFinal;
        let prob1T = U.normCdf(z) * 100;
        prob1T = U.clamp(prob1T, 0.1, 99.9);

        if (reqRestante > 1.0) prob1T = 0.0;
        if (reqRestante <= 0.0) prob1T = 100.0;

        const prob2T = 100 - prob1T;

        let projecao = '';
        let detalhe = '';

        if (prob1T >= 70) {
          projecao = `Forte probabilidade de vitória em 1º Turno para ${c0.nome} (${U.fmtPctPlain(prob1T)}%)`;
          detalhe = `${c0.nome} precisa de mais ${U.fmtInt(faltamParaLider50)} votos dos ${U.fmtInt(validosRestantes)} restantes (${U.fmtPct(reqRestante * 100)}). Comparecimento estimado: ${U.fmtInt(compTotalEst)} eleitores às urnas.`;
        } else if (prob2T >= 70) {
          projecao = `Cenário provável de 2º Turno entre ${c0.nome} e ${c1.nome} (${U.fmtPctPlain(prob2T)}%)`;
          detalhe = `${c0.nome} precisaria de mais ${U.fmtInt(faltamParaLider50)} votos dos ${U.fmtInt(validosRestantes)} restantes (${U.fmtPct(reqRestante * 100)}) para liquidar no 1º turno. Comparecimento: ${U.fmtPct(data.comparecimentoPct)}.`;
        } else {
          projecao = `Disputa aberta: ${U.fmtPctPlain(prob1T)}% de chance de 1º Turno vs ${U.fmtPctPlain(prob2T)}% de 2º Turno`;
          detalhe = `Faltam ${U.fmtInt(faltamParaLider50)} votos para ${c0.nome} atingir 50% dos válidos projetados (${U.fmtInt(validosTotalEst)}). Restam ${U.fmtInt(validosRestantes)} votos a apurar.`;
        }

        return {
          disponivel: true,
          tipo: 'turnos',
          probTurno1: Math.round(prob1T * 10) / 10,
          probTurno2: Math.round(prob2T * 10) / 10,
          cand1: c0.nome,
          cand2: c1.nome,
          reqRestante: Math.max(0, reqRestante * 100),
          faltamVotos: faltamParaLider50,
          validosRestantes,
          compTotalEst,
          projecao,
          detalhe
        };
      }

      // Eleição para Senador (cargo 5): 2 vagas diretas (sem 2º turno)
      if (race.cargo === 5) {
        const rem = 1 - s;
        const sigma0 = 0.12;
        const sigmaFinal = Math.max(0.002, sigma0 * Math.sqrt(s * rem));

        const probsSen = cands.slice(0, 4).map((c, idx) => {
          let probVaga = 50;
          if (idx === 0) {
            const diff = (c.pct - (c2 ? c2.pct : 0)) / 100;
            probVaga = U.normCdf(diff / (sigmaFinal * Math.SQRT2)) * 100;
          } else if (idx === 1) {
            const diff = (c.pct - (c2 ? c2.pct : 0)) / 100;
            probVaga = U.normCdf(diff / (sigmaFinal * Math.SQRT2)) * 100;
          } else if (idx === 2) {
            const diff = (((c1 ? c1.pct : 0) - c.pct)) / 100;
            probVaga = (1 - U.normCdf(diff / (sigmaFinal * Math.SQRT2))) * 100;
          } else {
            const diff = (((c1 ? c1.pct : 0) - c.pct)) / 100;
            probVaga = Math.max(0.1, (1 - U.normCdf(diff / (sigmaFinal * Math.SQRT2))) * 100);
          }
          return {
            sq: c.sq,
            nome: c.nome,
            pct: c.pct,
            prob: Math.round(U.clamp(probVaga, 0.1, 99.9) * 10) / 10
          };
        });

        const eleito1 = probsSen[0] ? probsSen[0].nome : '—';
        const eleito2 = probsSen[1] ? probsSen[1].nome : '—';

        return {
          disponivel: true,
          tipo: 'senador',
          candidatos: probsSen,
          projecao: `Projeção atual das 2 vagas: ${eleito1} e ${eleito2}`,
          detalhe: `Disputa da 2ª vaga: ${c1.nome} (${probsSen[1].prob}%) vs ${c2.nome} (${probsSen[2].prob}%).`
        };
      }

      return null;
    }
  };

  /** localStorage resiliente (modo privado, cota cheia, etc. nunca quebram a página). */
  function createStore(namespace) {
    const prefix = `apuracao2026:v1:${namespace}:`;
    return {
      get(key) {
        try {
          const raw = global.localStorage.getItem(prefix + key);
          return raw ? JSON.parse(raw) : null;
        } catch (_) {
          return null;
        }
      },
      set(key, value) {
        try {
          global.localStorage.setItem(prefix + key, JSON.stringify(value));
        } catch (_) {
          /* cota excedida ou storage bloqueado: segue só em memória */
        }
      }
    };
  }

  NS.U = U;
  NS.createStore = createStore;
})(window);
