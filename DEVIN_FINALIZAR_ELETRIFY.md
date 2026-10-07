# Prompt para Devin/Windsurf — concluir implantação e validar Eletrify

Você está recebendo a Eletrify 1.0 já implementada. Trabalhe neste projeto, preserve o visual azul/menta e os ativos originais, e finalize a configuração, testes reais e correções. Não recomece o projeto nem transforme em landing page. Leia README.md, docs/BRIEFING-COMPLETO-DEVIN.md, docs/INSTALACAO-SUPABASE.md, docs/MERCOSULPAY-v1.md, a transcrição do contrato e as migrações antes de alterar. O briefing completo é parte obrigatória deste prompt: contém regras de comissões, matriz de funcionalidades, ajustes encontrados no código e decisões pendentes.

## Objetivo de entrega

Plataforma operacional no domínio HTTPS do EasyPanel com autenticação Supabase, cinco áreas do usuário, administração, pagamentos Pix de depósito/saque e cron. A entrega final deve usar dados reais do projeto e não mostrar avisos de demonstração, prévia, etapa de desenvolvimento ou dependência de configuração. Conclua a instalação do Supabase e a validação das Edge Functions/webhooks; não encerre apenas com o frontend publicado. Corrija problemas encontrados e descreva a evidência de cada fluxo; nunca apresente teste com mock como pagamento real.

## 1. Preparação e preservação

- `npm ci`, `npm run build:sql`, `npm test`, `npm run test:ui`, `npm run check:edge`, `npm run build`.
- Use variáveis/secrets fornecidos pelo operador. Não escreva chaves ou tokens no código, no frontend, em logs ou no Git.
- Faça alterações incrementais e mantenha todos os recursos. Inspecione AGENTS.md e estrutura existente.
- Se houver Supabase existente, consulte schema atual e histórico de migrações antes de aplicar. A primeira migração suporta a profiles da etapa 1, mas não supõe outras tabelas preexistentes. Faça backup antes de alteração incompatível.

## 2. Supabase e autenticação

- Aplicar as cinco migrações em ordem com CLI; conferir roles/grants/RLS e owner das funções SECURITY DEFINER. Banco novo também pode usar `supabase/INSTALAR_ELETRIFY.sql`, que reúne as cinco; nesse caso, reconciliar somente as versões efetivamente aplicadas no histórico CLI conforme o guia antes de db push. Em banco existente, aplicar todas as pendentes, incluindo a quinta, `202610070001_launch_rules.sql`: após as três primeiras, faltam 004 e a quinta; após as duas primeiras, faltam 003, 004 e a quinta. Não reaplicar o instalador nem modificar as quatro migrações originais. As atualizações preservam contratos existentes, produtos personalizados e admins existentes. A quinta registra a mudança para 15%/5%/2% na auditoria, limita novos depósitos a R$35–R$5.000 por trigger sem impedir a liquidação de depósitos legados abaixo do mínimo e ajusta constraint/RPC de saque para R$30–R$10.000. Após adicionar novas migrações, regenerar o instalador com `npm run build:sql`.
- Configurar SMTP próprio, Site URL, Redirect URLs, confirmação de e-mail e templates HTML. Recuperação é Reset password, não Magic Link. Incluir callbacks finais e localhost.
- Criar conta do Eduardo, confirmar e-mail e promover somente seu UUID usando `supabase/sql/01_promover_admin.sql`. A autoridade é `public.profiles.is_admin IS TRUE` e `blocked IS FALSE`. Cadastro sempre grava false; metadata/body/UI não concedem privilégios. Testar usuário comum em `/admin` e `/#/admin`, RPCs admin e ações HTTP admin. Revogar a coluna mantendo a mesma sessão e repetir inclusive request_id administrativo já usado: deve negar. Testar admin bloqueado e auto-promoção por UPDATE direto recusada.
- Testar cadastro via referência, senha incorreta, confirmação/reenvio, link expirado, nova senha, sessão persistente, logout, alteração de e-mail e dados de perfil. Testar contato consentido e não consentido na equipe.
- Adicionar/validar políticas de termos/privacidade e a identidade da empresa com material real do operador.

## 3. MercosulPay e Edge Functions

Contrato: `https://mercosulpay.com/api/public/v1`; Bearer; valores em REAIS na borda e centavos no banco. Secret MercosulPay apenas nas Edge Functions.

- Deploy payments, mercosulpay-webhook e process-payments. Confirmar verificação de JWT via auth.getUser, HMAC na função pública e WORKER_SECRET no worker. O toml verify_jwt=false existe para permitir assinatura assimétrica e webhooks; não significa endpoint sem validação.
- APP_ORIGINS restringido à origem final, APP_URL correto.
- Cadastrar endpoint do webhook no painel da gateway e usar seu segredo.
- Assinatura exata `HMAC-SHA256(timestamp+'.'+rawBody)`, sha256=hex minúsculo, corpo bruto, comparação constante, janela 300s. Nunca aceitar corpo reserializado, assinatura inválida ou replay antigo.
- Obter amostras reais de JSON de pix.received e pix.sent. A documentação recebida NÃO mostra o envelope completo. Ajustar `processEvent` e parsing da lista/resposta de saque, adicionar fixtures e testes. Eventos inesperados devem ficar em análise sem alterar saldo.
- Conferir /balance e KYC do operador antes de teste de saque. Não tentar repetir 401/403.
- Usar reference_id local estável para todos os pedidos. No saque o POST é idempotente: retry do mesmo UUID, nunca UUID novo depois de timeout.
- Resposta e webhook usam net_amount incompatível: conciliar por total_debit. Conferir amount enviado (líquido ao destinatário), referência e provider_id.
- Depósito só credita completed consultado no endpoint; criar cobrança pending não aumenta saldo. Não enviar payer_document por padrão, pois bloqueia terceiros.
- Não há endpoint GET withdrawals no contrato entregue; confirmar com gateway antes de adicionar. Enquanto isso recuperar via POST idempotente.
- Cobrança POST não tem idempotência documentada. Em timeout, recuperar por reference_id nas cobranças recentes; não repetir cegamente. Confirmar filtro/paginação oficial para alto volume.
- Testar assinatura válida/inválida, entrega duplicada com mesmo ID, novo delivery ID para mesma transação, status fora de ordem, valores divergentes, indisponibilidade, limites e estorno com/sem saldo.
- Aplicar limite de taxa global para múltiplos workers se crescer o volume. Orçamento da gateway é 120 requisições/minuto por chave.

### 3.1. Implantação obrigatória no Supabase real

Use os arquivos existentes, configure, publique e valide as funções no projeto Supabase do operador. Não recrie a lógica financeira no navegador ou em um webhook paralelo no EasyPanel. O backend deve continuar responsável pelos valores, permissões e estados das transações.

| Função e arquivo | Autorização | Papel no fluxo final |
| --- | --- | --- |
| `payments` — `supabase/functions/payments/index.ts` | JWT validado com `auth.getUser` e perfil atual; ações administrativas exigem `is_admin=true`. | Criar/consultar cobranças Pix, ações administrativas de conta e acionamento autorizado do worker. |
| `mercosulpay-webhook` — `supabase/functions/mercosulpay-webhook/index.ts` | HMAC do corpo bruto com o segredo da gateway. | Receber eventos, deduplicar por delivery_id, persistir a inbox e responder rapidamente. |
| `process-payments` — `supabase/functions/process-payments/index.ts` | Header `x-worker-secret` validado no servidor. | Enviar os saques aprovados, processar a inbox e conciliar transações. |

Publique também as dependências locais de `supabase/functions/_shared`. Configure `MERCOSULPAY_API_KEY`, `MERCOSULPAY_WEBHOOK_SECRET`, `WORKER_SECRET`, `APP_ORIGINS` e `APP_URL` usando secrets do Supabase. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são variáveis do runtime das funções; a chave de servidor nunca vai ao frontend. Preserve as validações dos handlers e `supabase/config.toml`.

Com CLI instalada, projeto vinculado e um arquivo de segredos privado preenchido:

```sh
supabase secrets set --env-file /CAMINHO/PRIVADO/eletrify-functions.env
supabase functions deploy payments
supabase functions deploy mercosulpay-webhook
supabase functions deploy process-payments
```

Cadastre no painel MercosulPay a URL exata `https://SEU_PROJECT_REF.supabase.co/functions/v1/mercosulpay-webhook`; use o segredo desse cadastro no Supabase. Configure Vault e cron conforme a seção 4 e o guia de instalação. Confira os logs das funções, a inbox, as transações e a resposta HTTP do worker. Registre os arquivos/versões implantados no relatório de entrega, sem expor segredos.

### 3.2. Depósito completo: formulário até saldo confirmado

1. O usuário autenticado informa o valor entre R$35 e R$5.000. O frontend chama `payments` com a ação `create_deposit`, centavos inteiros e um UUID estável de solicitação. A função identifica o usuário pelo JWT, grava `deposits` e chama `POST /pix/charges` em reais com `reference_id` local.
2. Mostre o QR Code e Pix copia e cola recebidos, com botão de copiar e estado aguardando pagamento. Cobrança criada/pending não altera saldo; o navegador não credita valores. Em resposta incerta, preserve a referência e concilie; não crie automaticamente uma nova cobrança.
3. Após pagamento, a gateway envia `pix.received`. O webhook verifica assinatura/timestamp, persiste a entrega e responde 2xx. O worker consulta a cobrança, confere ID, referência e valor, e usa `settle_deposit` somente após confirmação `completed`.
4. Atualize a carteira, o extrato e a Dashboard a partir do estado confirmado no banco, sem exigir que o usuário gere outro QR. Use atualização moderada via snapshot do Supabase; não consulte a gateway a cada segundo. O botão de consultar pode funcionar como verificação adicional, nunca como confirmação fictícia.
5. Teste entrega duplicada, nova entrega da mesma cobrança, atraso no webhook, callback antes da resposta de criação, falha temporária e estorno. Comprove um único crédito e ausência de regressão de completed/refunded para pending. Revise os payloads reais antes de considerar esse fluxo concluído.

### 3.3. Saque completo: solicitação, aprovação, envio e conciliação

1. A solicitação do frontend passa por `app_action('withdrawal', ...)` no Supabase. O banco valida saldo, produto elegível, min/max, taxa e uma solicitação por dia no fuso Brasília. A operação deve reservar o valor e reduzir o disponível atomicamente; não escrever saldo diretamente pelo frontend.
2. Mostre a solicitação como aguardando aprovação. O admin pode aprovar um saque, selecionados ou todos, e habilitar/desabilitar saques. Somente perfil com `is_admin=true` pode autorizar. Aprovação não significa Pix enviado.
3. O worker obtém os saques aprovados com `claim_withdrawals`, usa a mesma `reference_id` em cada tentativa e envia `POST /pix/withdrawals` com o líquido, chave/tipo e documento do destinatário. Exemplo: pedido R$100, taxa plataforma R$5, envio R$95. Enquanto o resultado estiver pendente/incerto, mantenha a reserva e o status operacional correspondente.
4. Uma resposta completed validada ou o evento assinado `pix.sent` deve concluir via `settle_withdrawal`, liberar a reserva sem debitar novamente o disponível e atualizar o histórico. Valide referência, provider_id, amount e `total_debit`; não use `net_amount` para conciliar.
5. Rejeição anterior ao envio ou falha permanente confirmada deve devolver o saldo uma única vez, conforme as RPCs. Timeout/resultado incerto exige conciliação com a mesma referência, com reserva preservada. Teste callbacks duplicados, chegada durante o envio, pausa de saques, rejeição e limite diário após rejeição.

Teste em ambiente real o caminho inteiro: navegador → Edge Function/RPC → MercosulPay → webhook → inbox/worker → ledger/carteira → interface. Envio de Pix exige os testes de valores autorizados pelo operador. Se credenciais ou acesso estiverem pendentes, registre o bloqueio na comunicação técnica com o operador; não transforme essa pendência em texto de desenvolvimento na tela do cliente nem simule sucesso.

## 4. Cron e consistência financeira

- Habilitar Vault; preencher uma cópia privada de `supabase/sql/02_configurar_worker_vault.sql` com a URL real e o mesmo WORKER_SECRET das funções. Executar cron.sql: habilita pg_cron/pg_net e substitui somente os dois jobs Eletrify, sem duplicar. Conferir a resposta HTTP em net._http_response além do sucesso do job cron. Worker e webhook rejeitam placeholders de segredo. Executar `supabase/sql/03_verificar_instalacao.sql` e registrar apenas diagnósticos sem segredos.
- Verificar catch-up de períodos de 24h e unicidade de yield:id:período; rodar duas vezes e confirmar ausência de crédito duplicado.
- Testar vencimento em produção (10 dias) e distribuição (15 dias): último rendimento e devolução integral do capital devem entrar juntos no saldo. Conferir `principal_returned`, uma entrada `principal_return` por aquisição, unidade e dono; rodar o cron novamente sem duplicar o capital. Verificar presentes, quantidade maior que um, pausas e aquisições com termos personalizados. O capital devolvido não conta como rendimento.
- Banco embarcado cobre lógica mas ainda testar concorrência PostgreSQL real com duas sessões: compra simultânea, dois saques no mesmo dia, transferência simultânea, saldo insuficiente, workers concorrentes e callback durante envio.
- A fila de webhooks usa `claim_webhook_events`, `FOR UPDATE SKIP LOCKED`, lease de 10 minutos e claim_token. Testar dois workers: não devem obter a mesma entrega na lease atual; resultado de lease antiga não pode sobrescrever o atual. Após cinco falhas, manter evento em review para inspeção. O handler de criação/recuperação de cobrança deve preservar completed/refunded se a conciliação acontecer antes da resposta HTTP; não regredir para pending.
- Ajustar se houver deadlock. `purchase` bloqueia comprador e até três patrocinadores em ordem determinística; manter essa ordem em qualquer otimização.
- Confirmar ledger contra soma de wallets, reserva contra saques abertos, taxa contra payout e total_debit da gateway. Não permitir writes do browser nessas tabelas.
- Confirmar cliente normal não executa helpers financeiros, não lê outros saldos e não altera is_admin/referred_by.
- Backups, reconciliação e monitoramento dos registros em review. Usar retry de eventos/admin preservando idempotência. Não liberar reserva de saque incerto sem confirmar que não houve pagamento.

## 5. Regras do negócio e configuração restante

Use as condições já definidas abaixo e configure as pendências com o operador:
- Condições iniciais já definidas pelo Eduardo: produção 10 dias, distribuição 15 dias, taxas diárias a partir de 5% e devolução do valor investido no vencimento. Catálogo inicial usa 5%, 6%, 7% e 8% em cada categoria e vem inativo para ativação no admin. Preços, taxas e prazos permanecem editáveis. Não restaurar o padrão anterior de 30 dias/0%/sem devolução.
- Comissões iniciais aprovadas: N1=15%, N2=5% e N3=2%, configuráveis pelo admin. Comissão uma vez por comprador, sobre uma unidade da primeira compra própria, mesmo com várias unidades no pedido. Revisar a configuração aprovada antes de ativar compras. Presente não gera comissão nem consome a primeira compra própria.
- Depósitos entre R$35 e R$5.000; preservar a liquidação de cobranças legadas abaixo do novo mínimo.
- Saque uma vez por dia no fuso Brasília, inclusive se rejeitado; mínimo R$30/máximo R$10.000, taxa 5% deduzida: pedido R$30 → líquido R$28,50; pedido R$100 → líquido R$95.
- Produto ativo ou concluído é elegível para saque.
- Principal devolvido integralmente no vencimento por padrão; opção no admin vale para futuras compras. Termos são gravados na aquisição. Exemplo: R$100 a 5% durante 10 dias credita R$50 de rendimentos e devolve R$100 ao final. Não alterar retroativamente contratos anteriores sem orientação explícita do operador.
- Doação R$100 agregado por doador/dia; presentes apenas para descendentes em até três níveis. A aquisição de presente já é creditada ao destinatário; confirmar se deseja fluxo de aceite antes de receber.
- Produto pausado recupera períodos ao reativar; cancelamento não estorna automaticamente.
- Link do grupo oficial Eletrify. O link Renda Extra de referência não deve ser usado sem autorização.

### 5.1. Comissão: evento único por comprador, não fim da equipe

Aplicar a especificação detalhada e os exemplos de `docs/BRIEFING-COMPLETO-DEVIN.md`. Pagamento ocorre na compra própria confirmada, dentro da mesma transação de débito, posições, `first_purchase_at`, `commissions` e `ledger`; não no depósito/webhook de Pix nem no cron de rendimento. Compras futuras desse comprador não pagam de novo. Primeiras compras de outros descendentes continuam pagando ao patrocinador conforme sua distância de 1/2/3 níveis. O recebedor pode acumular eventos de compradores distintos.

Exemplo com as taxas aprovadas, também usadas em `tests/commissions.test.mjs`: Ana → Bruno → Carla → Diego, produto R$100, taxas 15%/5%/2%. Na primeira compra de Diego, Carla recebe R$15, Bruno R$5 e Ana R$2; na segunda compra de Diego, ninguém recebe nova comissão dele. Se Carla ou outro descendente fizer sua própria primeira compra, os ancestrais continuam elegíveis para esse novo evento. Três unidades na primeira compra de Diego custam R$300, mas a base aprovada é uma unidade de R$100, mantendo as comissões em R$15/R$5/R$2. Falha por saldo insuficiente não marca a primeira compra.

Usar centavos e bps inteiros, arredondamento floor, taxa/preço do banco e unicidade por origem/nível. Presentes/concessões não geram comissão e não impedem a primeira compra própria posterior do destinatário. Mudança futura de taxas/preços não recalcula créditos já pagos. Um nível a 0% não recebe e não é pago retroativamente quando a taxa muda; isso exige configuração prévia ao lançamento. Acrescentar snapshot auditável de taxa/base em migração nova, sem reescrever histórico. Não permitir edição de `referred_by` pelo cliente.

Executar `tests/commissions.test.mjs`, conferir total geral/por nível/por pessoa na Equipe contra ledger e testar concorrência no PostgreSQL hospedado. O backend atual não exige produto próprio do patrocinador e pode creditar patrocinador bloqueado; registrar a política final com o operador, sem inventar condições de elegibilidade. Comissão não deve ser confundida com rendimento diário, doação, taxa de saque ou devolução de principal.

## 6. Admin e ajustes operacionais

Testar salvar/desativar produto e alterar preço/taxa/dias; condições das posições já existentes preservadas. Editar perfil/e-mail do usuário, enviar recuperação, suspender conta; ajustar saldo disponível com motivo (reservado não alterado); conceder/editar/cancelar posição com motivo; aprovar saque único/selecionados/todos; rejeitar devolvendo saldo; habilitar/desabilitar saques e conferir efeito no worker. Toda alteração deve constar na auditoria.

Tratar pedidos acima dos limites, documentos/chaves Pix inválidos e submissões repetidas. Se mudar regras de negócio, atualizar testes e README. Adicionar paginação server-side para grandes bases (snapshot administrativo atual retorna coleções inteiras ou limites documentados). Corrigir a lista de ajustes do briefing completo: request_id preservado nas repetições do cliente, extrato com deltas disponível/reservado, “aprovar todos” abrangendo todos os requested, duração/lote do worker e pausa durante envio, referência inválida, contato/resumos da equipe, transferência estruturada, indicadores/recomendações e fuso explícito.

## 7. EasyPanel

- Serviço App Dockerfile raiz, porta3000, domínioHTTPS e healthcheck /api/health.
- Runtime SUPABASE_URL e SUPABASE_ANON_KEY públicas em config.js. Segredos gateway permanecem no Supabase.
- Verificar carregamento assets, rotas `/admin` e `/#/admin`, callbacks e recarga do navegador. Nunca retornar HTML em lugar de JS ausente.
- QA browser desktop e mobile (360/390/768/1440px), tema claro/escuro, formulários, teclado, erros e console. Conferir a leitura de nomes e preços dos produtos, rendimentos, resumos da equipe, regras da carteira, valores e datas dos extratos, tabelas do admin e mensagens de erro. Alternar o tema e recarregar para verificar a preferência salva; manter texto claro nos cartões escuros de saldo, convite e banners. Aplicar integralmente a remoção de demonstração descrita na seção 8.
- Aplicar CSP compatível com Supabase, gateway imagens data: e imagens autorizadas, se adequado; não bloquear recuperação/sessão.

## 8. Versão final: remover demonstração e comentários de processo

Esta é uma exigência de entrega do Eduardo. A interface de produção deve apresentar a Eletrify como produto final. Revise login, cadastro, recuperação, Dashboard, produtos, meus produtos, equipe, carteira, admin, banners, rodapé, diálogos, toasts e templates de e-mail.

- Remova os avisos e frases como “A prévia pode ser explorada em demonstração”, “O acesso real depende da configuração do Supabase”, “Explorar demonstração completa”, “Demonstração · dados e valores ilustrativos · nenhum pagamento real”, “depende de configuração”, “configurar depois”, “em desenvolvimento” e equivalentes que descrevam o processo de criação. Remova também mensagens de depósito/saque simulado e estados de teste apresentados como operações do usuário.
- Remova o botão de entrar/reiniciar demonstração, a faixa `.demo-bar`, atalhos para o modo fictício e seus handlers. Em `src/main.js`, revise `enterDemo`, `resetDemo`, `leaveDemo`, `isDemo`, os ramos condicionais de login/pagamentos e seus imports. Em `src/lib/store.js`, separe/remova do código de produção o seed, usuários/saldos/posições fictícios e liquidações simuladas. Não basta esconder os botões quando as variáveis Supabase estão presentes: o bundle final não deve conter um modo de movimentação financeira fictícia acessível.
- Elimine o fallback para dados de demonstração quando não houver configuração ou a API falhar. Limpe somente a chave legada `eletrify-demo-v3`, se necessário; preserve sessão real e preferência de tema. Dados sintéticos podem existir em fixtures de testes isoladas, sem serem incluídos no bundle público ou inseridos no banco de produção.
- Configure o Supabase real antes da entrega. Falha de serviço deve manter os saldos confirmados, impedir ações indisponíveis e mostrar uma mensagem curta apropriada, por exemplo “Não foi possível carregar os dados. Tente novamente.” Não mencionar Edge Functions, migrations, gateway secrets, frontend/backend ou etapas de implantação ao usuário final. Detalhes técnicos ficam nos logs e na documentação do operador.
- Preserve mensagens funcionais: confirmação de e-mail, aguardando pagamento, solicitação de saque, saque concluído, saldo insuficiente, produto indisponível, saques pausados e regras/taxas/prazos do contrato. Indicadores devem distinguir rendimentos já pagos de projeções; a limpeza editorial não deve anunciar uma operação não confirmada ou alterar condições financeiras. Mantenha a descrição honesta de imagens ilustrativas quando pertinente, sem comentários sobre como o projeto foi produzido.
- Revise textos do catálogo e dados já persistidos em `products.description`: não deixar copy de rascunho que instrui o cliente a configurar o admin. Não reescrever termos de posições adquiridas. Revise títulos/metadados da página e e-mails para manter apenas conteúdo adequado à Eletrify final.
- Adapte `scripts/smoke-ui.mjs` e os testes que dependem de demonstração. Use fixtures em ambiente de testes e QA com contas reais controladas no ambiente de validação; não apague testes financeiros, de autorização, webhook ou idempotência para fazer a remoção passar. Valide também o build de produção e fluxos sem sessão válida.
- Antes de publicar, faça uma busca de conteúdo em `src`, templates e `dist` para localizar frases de prévia/demonstração/processo; inspecione os resultados em contexto, sem apagar termos funcionais por substituição cega. Gere um build limpo, faça deploy da versão correta no EasyPanel e confira mobile/desktop em sessão nova e após recarregar. A ausência desses avisos na documentação interna não é exigida: README, guia e relatório podem explicar instalação e testes ao operador.

Adicione ao aceite uma verificação específica: sem modo demo, sem saldo fictício, sem atalhos que confirmam Pix localmente e sem textos de prévia/configuração nas telas públicas. As mensagens visíveis devem descrever apenas a ação e o estado real da conta ou transação.

## Aceite

Entregar URL HTTPS, commit, relação de migrations/functions/cron aplicados, resultado de testes e evidências de cadastro/compra/rendimento/depósito/saque/admin. Comprovar os fluxos de depósito e saque com webhook e atualização do saldo/histórico, comissões únicas nos três níveis e continuidade de novos descendentes, além da remoção de demonstração e comentários de processo da interface final. Registrar os percentuais/base aprovados e a conclusão dos itens do briefing completo. Acompanhar ao menos uma operação real de depósito e um saque autorizados pelo operador, ou reportar explicitamente se gateway não oferece sandbox e esses testes não foram feitos. Não transferir valores sem autorização de teste. Fazer ZIP final sem segredos/node_modules e atualizar documentação. Não declarar a integração real concluída apenas porque a tela ficou sem avisos ou um teste com mock passou.
