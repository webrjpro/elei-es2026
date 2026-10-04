/*!
 * Apuração 2026 — configuração central.
 * Este é o ÚNICO arquivo que você precisa editar no dia a dia.
 *
 * Códigos oficiais (fonte: resultados.tse.jus.br/oficial/comum/config/ele-c.json):
 *   1º turno  → 6257 (Eleição Federal: Presidente)  | 6259 (Eleição Estadual: Governador, Senador…)
 *   2º turno  → 6258 (Presidente)                    | 6260 (Governador)
 */
window.APURACAO_CONFIG = Object.freeze({
  /* Ambiente oficial de divulgação do TSE */
  base: 'https://resultados.tse.jus.br/oficial',
  ciclo: 'ele2026',

  /* Início da divulgação (horário de Brasília). Antes disso o painel exibe a contagem regressiva. */
  inicioDivulgacao: '2026-10-04T17:00:00-03:00',
  rotuloTurno: '1º turno · 4 de outubro de 2026',

  /* Frequência de consulta. O CDN do TSE renova o cache a cada ~40 s. */
  intervaloMs: 15000,      // durante a apuração
  intervaloPreMs: 60000,   // antes do início
  intervaloMaxMs: 120000,  // teto do backoff em caso de falha
  timeoutMs: 12000,
  intervaloTerritorialMs: 60000, // gráficos por estado: uma atualização por minuto

  /*
   * Proxy/cache opcional (recomendado para sites com muito tráfego).
   * Publique /worker/cloudflare-worker.js e cole a URL aqui, terminando em "?url=".
   * Ex.: 'https://apuracao.seu-usuario.workers.dev/?url='
   * Vazio = cada navegador consulta o TSE diretamente (com fallback automático para o proxy, se definido).
   */
  proxy: '',
  /* true = sempre usar o proxy primeiro (melhor quando há milhares de visitantes simultâneos). */
  proxyPrimeiro: false,

  /* Disputas exibidas. "top" = quantos mais votados aparecem durante a apuração. */
  corridas: [
    { id: 'presidente', titulo: 'Presidente',  local: 'Brasil',         eleicao: '6257', uf: 'br', cargo: 1, top: 4 },
    { id: 'governador', titulo: 'Governador',  local: 'Rio de Janeiro', eleicao: '6259', uf: 'rj', cargo: 3, top: 4 },
    { id: 'senador',    titulo: 'Senador',     local: 'Rio de Janeiro', eleicao: '6259', uf: 'rj', cargo: 5, top: 4 }
  ]
});
