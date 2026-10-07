# Verificação desta entrega — 06 e 07/10/2026

- Build Vite de produção: passou.
- TypeScript das três Edge Functions e módulos compartilhados: passou.
- 34 testes Node/PostgreSQL PGlite/handlers HTTP: passaram na revisão de 07/10. Cobrem débitos atômicos/idempotência, comissão única e níveis, saldo insuficiente, limite diário/reserva/rejeição de saque, limite de transferência/elegibilidade, catch-up e duplicidade de rendimentos, depósito só completed, permissões, conclusão de saque, condições iniciais, vencimentos de 10/15 dias, devolução única do capital, edição administrativa, preservação de dados na atualização, instalação completa e servidor EasyPanel. As Edge Functions reais foram transpiladas e executadas com Auth/PostgREST/gateway simulados.
- HMAC: corpo bruto válido aceito; corpo alterado, assinatura inválida e timestamp expirado rejeitados.
- Fluxos DOM da interface: seis áreas, sete abas admin, principais diálogos, compra múltipla, recarga simulada, solicitação/aprovação e conclusão simulada de saque: passaram.
- Servidor Node: health, configuração pública sem segredo gateway, rota admin e 404 de script inexistente: passaram.

## Atualização de contraste — 06/10/2026

Texto e fundo globais agora usam as cores do tema selecionado. Isso corrige nomes, preços, rendimentos, títulos e extratos que herdavam texto branco sobre os cartões claros. Os cartões de saldo, convite e banners mantêm suas cores próprias. Mensagens de erro, botão de copiar e navegação inferior também receberam ajustes de contraste no tema claro.

Build de produção e fluxos DOM foram executados novamente após a alteração. Uma checagem pontual das cores computadas aprovou 498 combinações de texto e fundo nos temas claro e escuro, incluindo as seis áreas, sete abas administrativas, diálogos e login; menor contraste verificado: 4,74:1. Essa checagem não substitui a inspeção visual em navegador, especialmente em telas móveis.

## Atualização das condições de investimento — 06/10/2026

Catálogo inicial: 10 dias em produção, 15 dias em distribuição, taxas de 5%, 6%, 7% e 8% por categoria e devolução integral do capital ativada. Preço, taxa e prazo continuam editáveis por produto; a política de devolução para novas compras é configurável no admin. A nova migração deve ser aplicada ao Supabase instalado.

Testes de vencimento conferiram o saldo antes do prazo, o último rendimento com a devolução do capital, compras com duas unidades e repetições do cron sem novos créditos. O teste DOM conferiu as sugestões de 10/15 dias no formulário de produto, prazo personalizado, mudança da política para compras futuras, capital devolvido nos detalhes e créditos de presentes ao destinatário. Build e TypeScript das Edge Functions passaram novamente. A prévia simula esses créditos somente no navegador.

A atualização sobre um banco com as duas migrações anteriores também foi testada: preserva contratos existentes sem devolução e produtos com taxa, prazo ou categoria personalizada, enquanto atualiza as condições do catálogo original ainda não alterado.

## Não executado neste ambiente

Instalação no Supabase do operador, PostgreSQL com múltiplas conexões, autenticação/SMTP real, cron hospedado, envio Pix, webhook real MercosulPay e deploy EasyPanel. O teste DOM não avalia geometria/layout como um navegador real; QA visual desktop/mobile está no prompt Devin. A prévia publicada é demonstrativa e não move dinheiro.

Os envelopes JSON ausentes na documentação entregue exigem validação/adaptação dos parsers. O código trata divergências como análise, com reserva preservada para saque e sem crédito automático de depósito.

## Admin, instalação e funções — 06/10/2026

A quarta migração consulta a coluna atual `profiles.is_admin` e exige conta não bloqueada. Cadastro com `user_metadata.is_admin=true` continua gravando false; UPDATE direto pelo cliente e chamadas às funções internas foram recusados. A revogação com a mesma identidade autenticada bloqueou snapshot administrativo, novas ações e repetição de request_id administrativo já usado. Conta admin bloqueada também foi recusada. Os handlers HTTP retornaram 401 sem sessão válida e 403 para ações administrativas de usuário comum, ignorando metadata e body forjados. Esses tokens e respostas Auth foram simulados; a validação real no Supabase hospedado permanece pendente.

O teste DOM conferiu remoção da navegação/painel admin após atualização da flag, redirecionamento para Dashboard quando a rota administrativa foi solicitada por usuário comum e restauração após promoção. A UI exige `is_admin===true` e `blocked===false`; a segurança permanece no banco e nas funções.

O instalador `supabase/INSTALAR_ELETRIFY.sql` foi gerado das quatro migrações e executado no PGlite com o esquema Auth simulado. Foram conferidas 13 tabelas com RLS e sem UPDATE direto de usuário, catálogo, diagnósticos SQL, promoção por UUID somente após confirmação e recusa de uma segunda instalação sem duplicar catálogo. As migrações antigas continuam separadas para atualizações. Vault, pg_cron e pg_net exigem validação no Supabase hospedado; não foram simulados como extensões instaladas aqui.

A inbox conferiu exclusividade da lease atual, recuperação após dez minutos, claim_token renovado, tentativa contada e rejeição de resultado com token antigo. Os handlers HTTP conferiram HMAC sobre corpo bruto, duplicata reconhecida sem crédito inline, segredo do worker e rejeição dos placeholders. A conciliação de `pix.sent` usou `total_debit` mesmo com `net_amount` divergente. Uma resposta de criação de cobrança posterior à confirmação preservou completed, sem regredir para pending. Não houve chamada externa de gateway nos testes.

Build, TypeScript e 27 testes passaram na verificação final. O guia de instalação e o prompt Devin foram atualizados com os passos restantes no ambiente real.

## Revisão completa de comissões e handoff — 07/10/2026

Foram adicionados sete testes de comissões, totalizando 34 testes aprovados no conjunto. Os testes usam as RPCs SQL reais em PGlite isolado e comprovam pagamentos a três ancestrais na primeira compra própria, base de uma unidade em compra múltipla, repetição sem crédito duplicado, continuidade dos primeiros eventos de outros descendentes, presentes/concessões sem comissão e sem consumo de elegibilidade, rollback por saldo insuficiente, níveis inicialmente zero sem pagamento retroativo, arredondamento em centavos, histórico preservado e parâmetros forjados ignorados. A configuração 15%/3%/1% usada nos testes é uma fixture; níveis 2/3 de produção continuam pendentes e inicialmente zero.

O novo `docs/BRIEFING-COMPLETO-DEVIN.md` foi integrado ao prompt e reúne regras, exemplos, jornadas, contabilidade, divergências encontradas e decisões de lançamento. A revisão identificou itens para a continuação no Devin, incluindo idempotência na repetição pelo cliente, semântica do extrato de reservas, alcance de “aprovar todos”, duração/pausa do worker, histórico auditável de taxas de comissão, indicadores/contatos/transferências e fuso da interface. Esses ajustes foram documentados como trabalho restante, não apresentados como corrigidos nesta revisão.

Esta atualização altera documentos e acrescenta testes; não muda a regra financeira implementada nem remove o modo demonstrativo por si só. A implantação real, conversão do frontend final e validação de concorrência/PostgreSQL hospedado continuam no escopo de continuidade definido para Devin.
