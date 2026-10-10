# Eletrify 1.0 — plataforma e administração

Frontend Vite/JavaScript; autenticação, banco e backend financeiro em Supabase; pagamentos Pix pela MercosulPay; servidor Node e Docker para EasyPanel.

Atualização de comunidade e boas-vindas: **[docs/ATUALIZACAO-GRUPO-E-CUPOM.md](docs/ATUALIZACAO-GRUPO-E-CUPOM.md)**. Inclui o novo grupo oficial, consulta privada de resgates e aviso de `ELETRIFY` para contas elegíveis.

## Acesso rápido

```sh
npm ci
npm run dev
```

Sem configuração Supabase, clique **Explorar demonstração completa**. Navegue pelas cinco áreas e pelo admin. Dados fictícios ficam somente no navegador e podem ser reiniciados. QR e transferências reais nunca são simulados como pagamentos externos. A demonstração some quando a configuração pública do Supabase é fornecida.

## Recursos incluídos

- Cadastro, confirmação/reenvio de e-mail, login, recuperação e redefinição de senha; templates HTML da marca.
- Dashboard, saldo disponível/reservado, capital ativo, rendimentos realizados/projetados, banners rotativos, catálogo e grupo WhatsApp em popup.
- Catálogo produção/distribuição; detalhes, quantidade, compra própria e presente à equipe; falta de saldo abre recarga.
- Meus produtos com contrato salvo na compra, períodos pagos, vencimento, capital a devolver/devolvido e recomendações por saldo/histórico.
- Equipe de três níveis, convites, contatos com consentimento, WhatsApp, comissões, presente e doação (R$100 por dia agregado).
- Carteira: depósitos, saque, status, extrato, histórico e filtro de movimentações.
- Admin `/admin` ou `/#/admin`, somente para `profiles.is_admin=true` e conta não bloqueada: catálogo, perfis/e-mails, saldo auditado, posições dos usuários, aprovações individuais/em lote, rejeição, pausa dos saques, taxas e auditoria/webhooks. Backend consulta a coluna atual; cadastro, JWT metadata e navegador não concedem admin.
- Backend: migrações PostgreSQL, RPCs transacionais, ledger e idempotência, Edge Functions de pagamentos/webhook/worker, cron, Dockerfile e servidor.

## Setup real

Guia completo, com comandos e ordem dos arquivos: **[docs/INSTALACAO-SUPABASE.md](docs/INSTALACAO-SUPABASE.md)**.

1. Criar um projeto Supabase e configurar SMTP/Email confirm.
2. `supabase login`, `supabase link --project-ref REF` e `supabase db push` para aplicar as cinco migrações, incluindo `202610070001_launch_rules.sql`. Alternativa para banco novo: colar `supabase/INSTALAR_ELETRIFY.sql` inteiro no SQL Editor. Instalação manual exige registrar o histórico antes de usar CLI depois; veja o guia. Não reaplicar migração já aplicada.
3. Configurar Site URL e Redirect URLs para a origem final, a origem com `?flow=recovery` e localhost de desenvolvimento. Templates em `supabase/templates`.
4. Cadastrar seu usuário e confirmar e-mail. Informar somente seu UUID em `supabase/sql/01_promover_admin.sql` e executar no SQL Editor como operador. Nunca atribuir admin com dados enviados no cadastro.
5. Copiar `supabase/.env.functions.example` para um arquivo privado; configurar chave MercosulPay, segredo do webhook, segredo do worker, APP_ORIGINS e APP_URL. `supabase secrets set --env-file ARQUIVO_PRIVADO`.
6. `supabase functions deploy payments`, `supabase functions deploy mercosulpay-webhook`, `supabase functions deploy process-payments`. O toml desabilita o check legado e cada handler verifica JWT real, HMAC ou segredo de worker.
7. Cadastrar na MercosulPay `https://REF.supabase.co/functions/v1/mercosulpay-webhook` e usar o segredo retornado.
8. Habilitar Vault; preencher/executar uma cópia privada de `supabase/sql/02_configurar_worker_vault.sql` com a URL e o mesmo WORKER_SECRET. Depois executar `supabase/cron.sql` e verificar logs cron/pg_net. Ele substitui somente os dois jobs Eletrify, sem duplicar. Rendimentos processados a cada 5 minutos, respeitando os aniversários de 24h de cada aquisição.
9. Em desenvolvimento preencher `.env` com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. No EasyPanel usar variáveis runtime SUPABASE_URL e SUPABASE_ANON_KEY; o servidor publica apenas essas duas em `/config.js`.
10. Abrir o admin e revisar/ativar o catálogo inicial: produção com 10 dias, distribuição com 15 dias e taxas diárias de 5%, 6%, 7% e 8% por categoria. Preços, taxas e prazos são editáveis. Os produtos vêm desativados para a ativação pelo operador. Devolução do capital ativada por padrão; saques inicialmente desativados. Configurar grupo oficial e revisar as comissões iniciais aprovadas: N1=15%, N2=5% e N3=2%, ainda editáveis pelo admin.

Em banco existente, aplicar todas as migrações pendentes, incluindo a quinta, `202610070001_launch_rules.sql`. Se as três primeiras já estiverem instaladas, faltam 004 e a quinta; se apenas as duas primeiras, faltam 003, 004 e a quinta, nessa ordem. Use `supabase db push` com o histórico correto. As quatro migrações originais são preservadas. A 003 ativa a devolução para novas compras e configura 10/15 dias e taxas a partir de 5%; preserva produtos personalizados e contratos existentes. A 004 reforça as permissões e inclui lease na fila do webhook; preserva admins já cadastrados. A quinta atualiza as comissões para 15%/5%/2% com auditoria, aplica o limite de depósitos na criação/alteração do valor sem impedir a liquidação de depósitos legados abaixo do mínimo e ajusta constraint/RPC de saque para mínimo R$30. Consulte `supabase/sql/03_verificar_instalacao.sql` após instalar.

## EasyPanel

- Serviço App com este projeto, Dockerfile na raiz, porta interna 3000, domínio HTTPS.
- Build `npm ci && npm run build`, start `node server.mjs` se preferir Nixpacks.
- Healthcheck `/api/health`.
- Banco e processamento financeiro ficam no Supabase. Não é necessário duplicar o webhook no Node/EasyPanel.
- Servidor expõe frontend e configuração pública em runtime. Chave MercosulPay e service_role nunca devem ser variáveis VITE.

## Regras definidas nesta entrega

- Depósitos entre R$35 e R$5.000.
- Saque R$30–R$10.000, uma solicitação por dia por usuário em America/Sao_Paulo, mesmo após rejeição. Produtos ativos ou concluídos habilitam a solicitação.
- Taxa 5% deduzida do valor solicitado. Débito e reserva incluem a taxa; mínimo R$30 → R$28,50 Pix; exemplo R$100 → R$95 Pix.
- Aprovação não envia automaticamente pelo cliente; o worker realiza os saques aprovados. Pausar saques bloqueia novas solicitações e novas chamadas ao provedor; operações já enviadas continuam conciliando.
- Comissão sobre uma unidade da primeira compra própria, mesmo com várias unidades no pedido; taxas iniciais aprovadas N1=15%, N2=5% e N3=2%, configuráveis pelo admin. Nenhuma comissão em presente ou concessão administrativa.
- Condições ficam gravadas na posição. Edição do catálogo só altera novas compras. Admin pode alterar condições futuras de uma posição com motivo auditado.
- O valor investido é devolvido integralmente ao saldo no vencimento, junto com o último rendimento, por padrão. O processamento registra uma única devolução por aquisição no extrato (`principal_return`), mesmo que o cron seja repetido. Cada unidade de uma compra múltipla possui sua própria devolução; presentes creditam o capital ao dono do produto.
- Produção inicia com 10 períodos de 24h; distribuição, 15. Taxas iniciais de 5% a 8% ao dia, calculadas sobre o capital original com centavos inteiros. O admin pode alterar preços, taxas e prazos de cada produto e a política de devolução para novas aquisições. Um produto novo sugere 5% e prazo de 10/15 dias conforme a categoria; valores explicitamente personalizados são mantidos.
- Exemplo com R$100 a 5% em produção: R$5 por dia, R$50 de rendimentos em 10 dias e devolução dos R$100 ao concluir o prazo; total R$150. O capital devolvido não é somado ao indicador de rendimentos recebidos.
- Produto pausado conserva a data original: ao reativar, recupera períodos vencidos. Cancelado não paga novos períodos e não estorna automaticamente a aquisição.
- Dados de contatos da equipe exigem consentimento. Nomes, produtos e situação são exibidos aos três níveis de patrocinadores.

## Verificação e limitações reais

`npm test`: banco PostgreSQL embarcado PGlite, HMAC/valores, handlers reais das Edge Functions com dependências HTTP simuladas e servidor EasyPanel. `npm run test:ui`: fluxos DOM da demonstração, incluindo revogação e redirecionamento admin. `npm run check:edge`: TypeScript das Edge Functions. `npm run build`: build de produção. `npm run build:sql`: regenera o instalador a partir das migrações.

Os testes não substituem autenticação/SMTP real, cron no Supabase hospedado, assinatura e payloads reais da gateway, concorrência em múltiplas conexões e entrega Pix. O contrato fornecido não incluiu envelopes JSON de webhook/lista nem consulta de saque; veja `docs/MERCOSULPAY-v1.md`. O prompt em `DEVIN_FINALIZAR_ELETRIFY.md` detalha essa validação.

O prompt Devin também exige a implantação das três Edge Functions no Supabase e a conferência dos fluxos completos de depósito/saque via webhook. A seção 8 define a remoção do modo demo, dados fictícios e frases de prévia/configuração do frontend de produção; mocks ficam restritos aos testes. Essa conversão é uma etapa da implantação final, com Supabase e gateway configurados, e deve ser validada no domínio EasyPanel.

**[docs/BRIEFING-COMPLETO-DEVIN.md](docs/BRIEFING-COMPLETO-DEVIN.md)** reúne a revisão completa: comissões com exemplos e gatilhos, árvore de três níveis, compras/presentes/doações, rendimentos/principal, contabilidade de disponível/reservado, matriz de funcionalidades, ajustes identificados no código e parâmetros pendentes. Deve ser lido junto com o prompt antes da continuidade. As taxas aprovadas são 15%/5%/2%, e a base é uma unidade mesmo em compra múltipla; `tests/commissions.test.mjs` e os exemplos refletem essas regras. Conferir sua aplicação no ambiente hospedado antes da ativação, sem tratar validação local como deploy concluído.

Não inserir chave real, senha ou segredo em Git. Imagens são conceituais de IA, não registro de fábrica/estoque. Adequar termos e origem dos rendimentos antes da operação pública. Projeções exibidas não são pagamentos realizados.
