# Apuração 2026 — ao vivo

Painel de apuração em tempo real das **Eleições 2026** com os **mais votados** para:

- **Presidente** (Brasil)
- **Governador** do Rio de Janeiro
- **Senador** pelo Rio de Janeiro

Fotos, partido, número, votos, % de votos válidos, % de seções totalizadas, comparecimento, abstenção, brancos, nulos, marcação de **Eleito / 2º turno** e gráfico de evolução — tudo atualizado sozinho, sem recarregar a página.

100% estático (HTML + CSS + JavaScript puro, sem dependências). Roda no **GitHub Pages**.

Os gráficos abaixo dos painéis mostram **Presidente por UF (26 estados e DF)**, com os três mais votados, e **Governador e Senador no estado inteiro do RJ**, com todos os candidatos. Exibem votos, percentuais, contagem de seções totalizadas, horário e link do arquivo oficial. É possível filtrar por estado e ordenar pelo avanço da apuração.

Os 27 arquivos estaduais para Presidente usam o mesmo leiaute EA20, por exemplo `dados/rj/rj-c0001-e006257-u.json`. Os gráficos estaduais consultam o TSE a cada minuto, com no máximo quatro conexões simultâneas, cache local do último dado oficial válido, rejeição de arquivos antigos e espera de cinco minutos após 404. Os gráficos do RJ reutilizam as consultas dos painéis, sem chamadas adicionais. Cada local pode ter um horário de atualização diferente. Seções totalizadas são o indicador oficial de avanço; não representam endereços individuais de urnas.

---

## Fonte dos dados (oficial, verificada)

Arquivos públicos de divulgação do TSE — `https://resultados.tse.jus.br/oficial` — no leiaute **EA20 (resultado unificado, `-u.json`)**:

| Disputa     | Arquivo                                                            |
|-------------|--------------------------------------------------------------------|
| Presidente  | `/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json`           |
| Governador  | `/oficial/ele2026/6259/dados/rj/rj-c0003-e006259-u.json`           |
| Senador     | `/oficial/ele2026/6259/dados/rj/rj-c0005-e006259-u.json`           |
| Fotos       | `/oficial/ele2026/<eleição>/fotos/<uf>/<sqcand>.jpeg`              |

Códigos confirmados em `/oficial/comum/config/ele-c.json` (pleito 3220, eleições 6257 e 6259).
O CDN do TSE libera CORS, então o navegador lê os arquivos diretamente.

## Publicar no GitHub Pages

1. Envie os arquivos para o repositório (branch `main`).
2. GitHub → **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/ (root)`** → Save.
3. Em ~1 minuto o site fica em `https://<usuario>.github.io/<repositorio>/`.

## Rigor e Dados Oficiais

Este projeto **não utiliza dados fictícios ou inventados**. Todo o fluxo é estritamente vinculado aos arquivos públicos e oficiais de totalização disponibilizados pela Justiça Eleitoral (`resultados.tse.jus.br`).

- **Antes das 17h:** Exibe a contagem regressiva oficial até a abertura da totalização e a lista oficial de candidatos deferidos/concorrentes obtida diretamente do TSE.
- **A partir das 17h:** Conforme as urnas são totalizadas pelos TREs e TSE, os números reais são consumidos e a tela atualiza as porcentagens, contagem de votos e ordenação dos mais votados no topo.

Para rodar localmente no computador: execute `python -m http.server 8080` na pasta do projeto e acesse `http://localhost:8080`.

## Como funciona (resiliência)

- **Nunca zera a tela**: o último dado oficial válido fica em memória e no `localStorage`; ao reabrir a página ele aparece na hora.
- **Validação**: cada arquivo é conferido (eleição, abrangência, cargo, candidatos, totais). Arquivo inválido é descartado e o anterior permanece.
- **Anti‑regressão**: se um nó do CDN entregar um arquivo mais antigo que o já exibido, ele é ignorado.
- **Eficiente**: consulta a cada 15 s com revalidação por `ETag`/`Last-Modified` (só baixa quando mudou), *jitter* para não sincronizar visitantes, pausa com a aba oculta, retomada imediata ao voltar ou reconectar.
- **Falhas**: *backoff* exponencial (até 2 min); faixa "Último dado oficial recebido … Tentando obter novos dados…"; 404 espera 5 min (o TSE bloqueia IP com muitos 404).
- **17h automático**: contagem regressiva vira painel de apuração sozinha.
- **Segurança**: CSP restritiva, nenhum `innerHTML` (imune a XSS por dados externos), nenhum script de terceiros.
- Limite do TSE: 100 req/s por IP. Cada visitante faz ~0,2 req/s, do próprio IP.
  Os gráficos por UF acrescentam até 27 consultas por minuto, distribuídas em quatro conexões.

## Muito tráfego? Ative o proxy/cache (opcional, grátis)

`worker/cloudflare-worker.js` é um proxy com cache de borda de 10 s, restrito aos JSON oficiais do TSE.
Publique no Cloudflare Workers e preencha em `js/config.js`:

```js
proxy: 'https://SEU-WORKER.workers.dev/?url=',
proxyPrimeiro: true,
```

Sem proxy, o site já funciona; com proxy, ele também vira rota alternativa automática.

## 2º turno (25/10/2026)

Em `js/config.js`: troque `eleicao` para **6258** (Presidente) e **6260** (Governador), ajuste `inicioDivulgacao`, `rotuloTurno` e remova a linha do Senador.

## Estrutura

```
index.html
css/styles.css
js/config.js   ← único arquivo de configuração
js/core.js     utilitários + localStorage resiliente
js/tse.js      URLs, download, validação e modelo oficial
js/ui.js       renderização incremental, animações, gráfico
js/territory.js gráficos oficiais por UF e estado do RJ
js/app.js      ciclo de consulta, estado, tolerância a falhas
worker/cloudflare-worker.js  proxy/cache opcional
```

## Verificação antes de publicar

Com Playwright instalado, execute `node tests/browser.cjs` (ou defina `PLAYWRIGHT_MODULE` com o caminho do pacote). O teste baixa os 30 arquivos reais do TSE, compara as seções e líderes de todas as UFs, confere todos os candidatos das duas disputas do RJ, filtros, ordenação, atualização automática e manual, layout em 1440/390/320 px, cache offline, rejeição de arquivos inválidos/antigos e espera após 404. Ao final, verifica também as conexões diretas ao TSE no navegador, sem interceptação. As capturas ficam na pasta temporária do sistema. Os arquivos oficiais usados nos testes não são incluídos no site.

## Aviso

Projeto independente, sem vínculo com o TSE. Em caso de divergência, prevalece o resultado oficial em [resultados.tse.jus.br](https://resultados.tse.jus.br).
A verificação criptográfica das assinaturas JWS dos arquivos não é feita no navegador; os dados são lidos via HTTPS do domínio oficial do TSE.
