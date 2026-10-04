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
