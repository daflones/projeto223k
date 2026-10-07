# Eletrify — instalação do Supabase

Este pacote contém o banco e as três Edge Functions. A aplicação no EasyPanel serve o frontend; autenticação, saldo, operações e processamento financeiro ficam no Supabase. Execute a instalação no seu projeto real antes de conectar o frontend. As verificações locais usam banco embarcado e serviços simulados; não representam deploy nem Pix real.

## Arquivos e ordem

| Arquivo | Finalidade |
| --- | --- |
| `supabase/INSTALAR_ELETRIFY.sql` | Banco inicial completo: cinco migrações em uma transação. |
| `supabase/migrations/*.sql` | Histórico canônico para CLI e atualização de banco existente. |
| `supabase/sql/01_promover_admin.sql` | Promove somente o UUID informado, após confirmação do e-mail. |
| `supabase/sql/02_configurar_worker_vault.sql` | Cria ou atualiza URL/segredo do worker no Vault. |
| `supabase/cron.sql` | Agenda rendimentos e worker, sem duplicar os jobs Eletrify. |
| `supabase/sql/03_verificar_instalacao.sql` | Consulta tabelas, RLS, permissões, admins e filas sem revelar segredos. |
| `supabase/config.toml` | Configuração das três Edge Functions. |
| `supabase/.env.functions.example` | Modelo dos segredos de servidor, sem valores reais. |
| `supabase/templates/*.html` | Confirmação, recuperação, mudança de e-mail e link mágico. |

## 1. Banco novo

Escolha uma das duas formas abaixo. Não execute o instalador e depois reaplique as mesmas migrações.

**Pelo SQL Editor:** no projeto Supabase, cole o conteúdo inteiro de `supabase/INSTALAR_ELETRIFY.sql` e execute como operador `postgres`. Ele verifica a presença de `auth.users` e recusa um banco Eletrify já instalado. Não é um script para recriar ou apagar um banco existente. A `profiles` da etapa inicial pode ser aproveitada se tiver o esquema compatível; instalações diferentes exigem revisão antes de aplicar.

**Pela CLI:** com a CLI Supabase instalada e a raiz do projeto como diretório atual:

```sh
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase migration list
supabase db push --dry-run
supabase db push
```

As migrações são:

1. `202610060001_platform.sql`: tabelas, cadastro, RPCs, ledger, saques e rendimentos.
2. `202610060002_catalog.sql`: oito produtos iniciais desativados.
3. `202610060003_investment_terms.sql`: produção 10 dias, distribuição 15, taxas a partir de 5% e devolução do capital.
4. `202610060004_admin_and_webhook_queue.sql`: admin pelo valor atual da coluna, permissões diretas revogadas e fila de webhook com bloqueio/lease para workers.
5. `202610070001_launch_rules.sql`: taxas iniciais N1=15%, N2=5% e N3=2% com auditoria, trigger para depósitos de R$35–R$5.000 e constraint/RPC de saque de R$30–R$10.000. As quatro migrações originais são preservadas.

Se instalou pelo SQL Editor e vai usar CLI depois, confira o esquema e registre **somente as versões efetivamente aplicadas** no histórico:

```sh
supabase link --project-ref SEU_PROJECT_REF
supabase migration repair 202610060001 202610060002 202610060003 202610060004 202610070001 --status applied
supabase migration list
```

`migration repair` altera o histórico, não executa o SQL. O exemplo inclui as cinco versões: registre `202610070001` somente se a quinta migração tiver sido efetivamente aplicada; retire do comando qualquer versão ainda pendente. Use esse comando apenas depois de conferir a instalação. O arquivo único é gerado por `npm run build:sql`; futuras mudanças devem entrar em novas migrações, seguidas dessa geração.

## 2. Banco já existente

Consulte o histórico remoto antes de atualizar e aplique **todas as migrações pendentes, incluindo `202610070001_launch_rules.sql`**. Se as primeiras três já estiverem aplicadas, execute 004 e depois a quinta. Se apenas as duas primeiras estiverem aplicadas, execute 003, 004 e a quinta, nessa ordem. Se as quatro originais estiverem aplicadas, falta a quinta. Com histórico correto, `supabase db push` identifica as pendentes. Não use o instalador completo para atualização nem reaplique versões já instaladas.

A migração 003 conserva os termos dos contratos já adquiridos e os produtos personalizados. A 004 conserva os admins já existentes e define `false` para cadastros futuros; não promove contas. Uma antiga coluna nullable é normalizada para `NOT NULL DEFAULT false`.

A quinta migração atualiza `platform_settings.commission_bps` para `{1500,500,200}` e registra as taxas anteriores/novas e as regras na auditoria; as taxas continuam configuráveis pelo admin, sem recalcular comissões já pagas. A base permanece uma unidade da primeira compra própria, mesmo em pedido múltiplo. O trigger de depósitos valida R$35–R$5.000 no INSERT ou na alteração de `amount_cents`, preservando a liquidação de depósitos legados de menor valor quando o valor não é alterado. O mínimo de saque passa a R$30 tanto na constraint quanto na RPC, com máximo R$10.000 e taxa de 5% (líquido mínimo R$28,50).

## 3. Autenticação e primeiro admin

No Supabase Auth, configure SMTP, confirmação de e-mail, Site URL e Redirect URLs para o domínio HTTPS final. Inclua também `https://SEU-DOMINIO/?flow=recovery` e a origem de desenvolvimento usada. Cole os templates em Auth > Email Templates: `confirm-signup.html` em Confirm signup, `reset-password.html` em Reset password e `change-email.html` em Change email address. Recuperação de senha usa Reset password; o template Magic Link é opcional para esse outro fluxo.

Cadastre o usuário pelo aplicativo e confirme o e-mail. Copie o UUID em Authentication > Users. No arquivo `supabase/sql/01_promover_admin.sql`, substitua o UUID zerado pelo UUID dessa conta e execute no SQL Editor. Não utilize e-mail como critério genérico para promover várias contas. O script exige perfil existente, conta não bloqueada e e-mail confirmado, e registra a promoção na auditoria.

Somente `public.profiles.is_admin IS TRUE`, com `blocked IS FALSE`, libera o admin. A coluna é lida pelo backend; `user_metadata.is_admin`, parâmetros HTTP e alterações no navegador não concedem privilégios. O cadastro sempre grava `is_admin=false`. O usuário autenticado chama RPCs e não pode escrever diretamente em `profiles`, `wallets` ou outras tabelas. `/admin` e `/#/admin` redirecionam usuários comuns para a Dashboard; os endpoints também recusam operações administrativas.

Para revogar, execute no SQL Editor com o UUID exato:

```sql
update public.profiles set is_admin=false where id='UUID_DA_CONTA';
```

A próxima chamada administrativa é negada mesmo com a sessão ainda válida. A interface remove o admin na próxima atualização ou navegação. A conta ilustrativa da demonstração possui `is_admin=true` apenas no estado local; ela não é uma conta Supabase.

## 4. Segredos e Edge Functions

Copie `supabase/.env.functions.example` para um arquivo privado fora do repositório e preencha:

| Variável | Valor |
| --- | --- |
| `MERCOSULPAY_API_KEY` | Chave da conta verificada no painel da MercosulPay. |
| `MERCOSULPAY_WEBHOOK_SECRET` | Segredo do endpoint de webhook cadastrado na gateway. |
| `WORKER_SECRET` | Segredo aleatório de pelo menos 32 caracteres; use 64 hexadecimais. |
| `APP_ORIGINS` | Origens HTTPS permitidas, separadas por vírgula, sem caminhos. |
| `APP_URL` | Origem HTTPS final usada no callback de recuperação. |

Para gerar o segredo do worker localmente: `openssl rand -hex 32`. Guarde o resultado no arquivo privado e no Vault; não publique o resultado. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vêm do runtime hospedado, não devem ir para variáveis VITE nem para o navegador.

Na raiz do projeto vinculado:

```sh
supabase secrets set --env-file /CAMINHO/PRIVADO/eletrify-functions.env
supabase functions deploy payments
supabase functions deploy mercosulpay-webhook
supabase functions deploy process-payments
```

Mantenha `verify_jwt=false` em `supabase/config.toml`, pois cada endpoint implementa a sua validação. No deploy pelo painel, configure essa opção em cada função e envie também os arquivos de `_shared`; a CLI envia as dependências locais automaticamente.

| Função | Autorização | Responsabilidade |
| --- | --- | --- |
| `payments` | JWT validado por `auth.getUser`; perfil atual consultado no banco. Admin exige `is_admin=true`. | Criar/consultar cobrança; ações administrativas de e-mail/recuperação; acionar worker. |
| `mercosulpay-webhook` | HMAC SHA-256 do corpo bruto e timestamp, com janela de 300 segundos. | Persistir entrega única na inbox e responder rápido. Não credita saldo no recebimento. |
| `process-payments` | Header `x-worker-secret` com o segredo configurado. | Enviar saques aprovados, conciliar eventos e recuperar cobranças de resultado incerto. |

O worker rejeita segredo ausente, curto ou ainda com placeholder. A função pública de webhook rejeita assinaturas inválidas e timestamps antigos. As duas funções não usam sessão do usuário; não coloque chave `service_role` na URL ou no frontend para chamá-las.

## 5. Webhook MercosulPay

Cadastre no painel da gateway:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/mercosulpay-webhook
```

Use o segredo correspondente em `MERCOSULPAY_WEBHOOK_SECRET`. Eventos Pix usados: `pix.received`, `pix.sent` e `pix.refunded`. A entrega fica na `webhook_inbox`, deduplicada por `delivery_id`; o worker usa uma lease de 10 minutos e `claim_token` para impedir que um resultado antigo sobrescreva o trabalho de outro worker. Liquidações financeiras continuam idempotentes por transação e evento de ledger. Após cinco tentativas sem processamento o evento fica em `review`, visível no admin para inspeção/reenvio.

Leia `docs/MERCOSULPAY-v1.md`. O contrato recebido não contém exemplos completos dos envelopes JSON dos webhooks/listas. O parser aceita a transação na raiz ou em `data` e exige correlação de referência, ID e valores. Confirme com payloads reais antes de ativar a operação. Campos divergentes ficam em análise, sem crédito inferido. Na conciliação de saque usamos `total_debit`; `net_amount` tem significados diferentes na resposta e no webhook v1.

## 6. Vault e cron

Habilite Vault (`supabase_vault`) nas extensões do projeto. No SQL Editor, use uma cópia privada de `supabase/sql/02_configurar_worker_vault.sql`: substitua a URL pela função `process-payments` do projeto e o segredo pelo mesmo `WORKER_SECRET`. O script cria/atualiza `eletrify_worker_url` e `eletrify_worker_secret`; não devolve o segredo na consulta. Restrinja acesso ao Vault a operadores de servidor.

Depois execute `supabase/cron.sql`. Ele habilita `pg_cron`/`pg_net`, verifica os segredos antes de agendar e substitui somente jobs com os nomes abaixo:

| Job | Frequência | Efeito |
| --- | --- | --- |
| `eletrify-yields` | A cada 5 minutos | Paga os períodos completos de 24h de cada aquisição, recupera atrasos e devolve o principal no vencimento. |
| `eletrify-payments` | A cada minuto | Invoca o worker via `pg_net`; envia apenas saques aprovados e processa a inbox. |

Confirme os jobs ativos no painel Cron, os resultados em `cron.job_run_details` e o status HTTP em `net._http_response`. Sucesso do job HTTP significa que a chamada foi enfileirada; confira também a resposta HTTP da Edge Function. Não consulte nem exporte `vault.decrypted_secrets` em relatórios de diagnóstico.

## 7. Frontend e regras iniciais

No EasyPanel: porta 3000, Dockerfile da raiz, domínio HTTPS. Configure apenas `SUPABASE_URL` e `SUPABASE_ANON_KEY` públicas no servidor frontend. Ele expõe essas duas variáveis em `/config.js`; o restante fica nas Edge Functions. Em desenvolvimento use os nomes `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env` local.

No admin, revise e ative o catálogo: produção 10 dias, distribuição 15 dias, taxas iniciais 5%–8% ao dia; preços/taxas/prazos editáveis. Devolução integral do capital está ativada para novas aquisições. Produtos e saques iniciam desativados. Configure o grupo oficial e revise as comissões iniciais aprovadas N1=15%, N2=5% e N3=2%, configuráveis pelo admin. A comissão incide sobre uma unidade da primeira compra própria, mesmo em pedido múltiplo. Edições de catálogo não alteram contratos existentes.

Depósitos entre R$35 e R$5.000. Saque R$30–R$10.000, uma solicitação por dia em Brasília, produto elegível e saldo disponível, aprovação administrativa e taxa de 5% descontada do valor solicitado. Uma solicitação rejeitada também consome o limite do dia. No mínimo, R$30 solicitados debita/reserva R$30 e envia R$28,50 por Pix; R$100 solicitados debita/reserva R$100 e envia R$95.

## 8. Conferência e continuidade no Devin

Execute `supabase/sql/03_verificar_instalacao.sql`. Esperado: 13 tabelas com RLS e sem acesso direto de `anon`/`authenticated`; cliente autenticado executa apenas `app_snapshot`/`app_action` dentre as funções financeiras listadas. Cadastros comuns devem ter `is_admin=false`. As outras funções são internas ou de servidor.

No ambiente real, teste login e confirmação, acesso comum direto ao admin, auto-promoção recusada, promoção/revogação com a mesma sessão, conta bloqueada, rendimentos no vencimento sem duplicidade, depósito `pending` sem crédito e saque aprovado com conciliação. `payments` sem JWT deve retornar 401; usuário comum pedindo ação admin, 403; worker sem o segredo correto, 403; webhook com assinatura inválida, 401. Essa checagem de autorização não transfere valores.

Siga `DEVIN_FINALIZAR_ELETRIFY.md` para verificar SMTP, callbacks, concorrência PostgreSQL, cron, payloads reais e Pix com os valores de teste autorizados pelo operador. Ainda precisam ser realizados no projeto hospedado. Não apresentar mocks como prova de webhook ou pagamento real.

## 9. Automação pela Management API

`scripts/supabase-admin.mjs` usa `SUPABASE_ACCESS_TOKEN` do ambiente. Não passe valores secretos na linha de comando. Por compatibilidade com a preparação local, `--credentials-file CAMINHO_PRIVADO` lê somente os campos necessários do formulário fornecido pelo operador, sem imprimir valores. O formulário preenchido está excluído do Git; as credenciais que foram expostas ainda precisam ser substituídas antes da liberação pública.

```sh
node scripts/supabase-admin.mjs --project PROJECT_REF
node scripts/supabase-admin.mjs --project PROJECT_REF --inspect-backend
node scripts/supabase-admin.mjs --project PROJECT_REF --verify
node scripts/supabase-admin.mjs --project PROJECT_REF --verify-backend
```

Sem flags de alteração, o script apenas consulta o inventário. As ações de escrita são explícitas:

- `--install-empty`: somente para banco realmente novo, sem tabelas públicas, usuários, triggers de cadastro ou histórico. Aplica o instalador e registra as cinco versões canônicas em `supabase_migrations.schema_migrations` na mesma transação. Não execute o instalador novamente nem repare versões já registradas.
- `--deploy-functions`: publica as três funções com seus arquivos `_shared` e `verify_jwt=false`, mantendo as verificações próprias dos handlers.
- `--configure-backend --origin https://eletrify.me`: configuração inicial dos secrets, Vault e cron, com catálogo/saques desativados e filas vazias. Requer as credenciais privadas MercosulPay. Gera o worker secret em memória, sem arquivo local; recusa substituir um segredo já existente no Vault ou reagendar jobs existentes.
- `--configure-auth --origin https://eletrify.me`: configura Site URL, redirects exatos de produção/desenvolvimento e confirmação obrigatória, preservando o provedor SMTP atual.
- `--configure-templates`: ação separada para os três templates. O Supabase recusou essa operação no projeto Free com provedor de e-mail padrão; não considerar os HTMLs publicados enquanto essa restrição não for resolvida. Configurar SMTP personalizado também é necessário para atender usuários externos em produção; aumentar o plano não comprova que o envio padrão atende a esse uso.

A verificação de backend consulta os jobs e as respostas HTTP do `pg_net`, testa negação de acesso aos endpoints sem credenciais e, quando a chave pública está disponível, valida Auth e bloqueio de leitura anônima de carteiras. Não cria cobranças, não envia saques e não envia e-mails. Os testes financeiros locais continuam sendo mocks/PGlite, não comprovação de Pix real.

Referências oficiais: [deploy de Edge Functions](https://supabase.com/docs/guides/functions/deploy), [validação de JWT no handler](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [agendamento de funções](https://supabase.com/docs/guides/functions/schedule-functions), [Vault](https://supabase.com/docs/guides/database/vault), [histórico de migrações](https://supabase.com/docs/reference/cli/supabase-migration-repair).
