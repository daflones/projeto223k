# Eletrify — briefing completo de continuidade para Devin

Revisão do projeto em 07/10/2026. Leia junto com `DEVIN_FINALIZAR_ELETRIFY.md`, `README.md`, `docs/INSTALACAO-SUPABASE.md` e o contrato MercosulPay. Este documento reúne as regras, o comportamento encontrado no código, os pontos a corrigir e o aceite. A existência do código e dos testes locais não comprova implantação, SMTP, cron ou Pix real.

O projeto do ZIP é a base a continuar. Preserve identidade Eletrify, imagens e navegação; o repositório `daflones/multicrypto` e a Nofy foram referências de apoio, não uma especificação a copiar. Não trocar gateway, inventar percentuais de comissão ou reiniciar o projeto em outro framework. As instruções expressas de Eduardo prevalecem; diferenças e escolhas técnicas abaixo devem ser resolvidas com ele antes de mudar direitos financeiros.

## 1. Comissões: regra central e origem da equipe

Eduardo definiu: comissão quando o afiliado adquire o primeiro produto, uma vez por afiliado, sobre uma única unidade mesmo em compra múltipla; taxas iniciais aprovadas N1=15%, N2=5% e N3=2%, configuráveis pelo admin. O patrocinador deixa de receber novas comissões das compras dessa mesma pessoa, mas continua recebendo as comissões das primeiras compras de outros descendentes nos níveis 2 e 3. Essa limitação é por comprador de origem, não um limite de uma comissão na vida do patrocinador nem o encerramento de toda a sua equipe.

A indicação entra pelo link `/?ref=CODIGO`. No cadastro, o backend resolve o código e grava `profiles.referred_by`; esse vínculo determina a árvore. Não usar parâmetros de compra, metadata enviada depois, WhatsApp ou e-mail para escolher o beneficiário. Não permitir autoindicação, ciclos ou troca de patrocinador pelo cliente. O código atual vincula apenas no cadastro; manutenção futura da árvore exige análise das comissões históricas, não uma edição genérica de perfil.

| Relação a partir do comprador | Recebedor | Nível |
| --- | --- | --- |
| Quem indicou o comprador | Patrocinador direto | 1 |
| Quem indicou o patrocinador direto | Segundo ancestral | 2 |
| Quem indicou o segundo ancestral | Terceiro ancestral | 3 |
| Acima desses três ancestrais | Sem comissão deste evento | Fora do programa atual |

Sem ancestral num nível, aquele pagamento não existe; não redistribuir automaticamente o percentual para outro nível. No código atual, o patrocinador não precisa ter produto próprio para receber comissão. A situação de conta bloqueada precisa de política explícita: atualmente o crédito pode entrar no saldo do patrocinador bloqueado, enquanto suas ações ficam impedidas. Não criar exigência de atividade ou excluir créditos por bloqueio sem decisão de negócio registrada.

### Percentuais e base do cálculo

| Item | Comportamento atual | Decisão de lançamento |
| --- | --- | --- |
| Nível 1 | 15% inicial, `1500` bps | Definido por Eduardo; configuração do programa é editável pelo admin. |
| Nível 2 | 5% inicial, `500` bps | Aprovado por Eduardo; permanece editável pelo admin. |
| Nível 3 | 2% inicial, `200` bps | Aprovado por Eduardo; permanece editável pelo admin. |
| Compra com várias unidades | Base é o preço de **uma unidade** da primeira compra própria | Regra aprovada, mesmo que o pedido tenha várias unidades; não usar o total do pedido. |
| Nova compra, outro produto ou categoria | Não gera nova comissão desse comprador | Preservar a regra de pagamento único. |

O texto encaminhado sobre a Nofy não define automaticamente as taxas da Eletrify. As taxas aprovadas de lançamento são `{1500,500,200}` (15%/5%/2%), aplicadas pela quinta migração `202610070001_launch_rules.sql`. Os antigos 3%/1%, se mantidos em fixtures de configuração alternativa, não são as taxas de lançamento; os exemplos abaixo e `tests/commissions.test.mjs` usam 15%/5%/2%.

As taxas vêm de `platform_settings.commission_bps`. São três inteiros em basis points: 100 bps = 1%; 1500 bps = 15%. No PostgreSQL, os índices do array são 1/2/3; no JavaScript, 0/1/2. A comissão é `floor(base_cents * bps / 10000)`, em centavos inteiros, arredondada para baixo. Não calcular com float ou confiar em taxa/preço enviados no navegador. A soma das taxas é limitada pelo banco a 100%; alterações de taxa valem para eventos futuros.

**Atenção operacional verificável:** um nível com taxa zero não recebe crédito, mas a primeira compra do comprador é marcada mesmo assim. Aumentar a taxa depois não cria retroativamente comissão das primeiras compras já ocorridas. A segunda compra não recupera esse evento. Configure as taxas finais antes de ativar o catálogo; se Eduardo quiser outro comportamento para período de programa desativado, implemente uma regra específica e testes, sem pagamentos retroativos silenciosos.

### Exemplo com quatro pessoas

Ana indicou Bruno; Bruno indicou Carla; Carla indicou Diego. Com as taxas aprovadas de lançamento N1=15%, N2=5%, N3=2% e produto de R$100:

| Primeira compra própria | Quem recebe | Nível | Comissão |
| --- | --- | --- | --- |
| Bruno compra | Ana | 1 | R$15 |
| Carla compra | Bruno | 1 | R$15 |
| Carla compra | Ana | 2 | R$5 |
| Diego compra | Carla | 1 | R$15 |
| Diego compra | Bruno | 2 | R$5 |
| Diego compra | Ana | 3 | R$2 |

Segunda compra de Bruno, Carla ou Diego não repete essas comissões. Ana continua podendo receber de novos compradores nos seus três níveis. Se Diego comprar três unidades na primeira operação, ele paga R$300, mas a base aprovada da comissão permanece R$100: Carla recebe R$15, Bruno R$5 e Ana R$2. Falha por saldo insuficiente não gera comissão e não consome a primeira compra.

### Gatilho, transação e histórico

O gatilho real é a compra própria confirmada pela RPC `app_action`, não cadastro, depósito, emissão de QR, webhook, aprovação de saque ou cron de rendimento. Depósito completed disponibiliza saldo; a compra feita com esse saldo é outro evento. Saldo válido recebido por transferência ou ajuste administrativo também pode financiar compra própria no comportamento atual. Não inventar filtro por origem do dinheiro sem regra definida.

A rotina bloqueia o perfil comprador, verifica `first_purchase_at`, debita a compra, cria as posições com seus termos, marca a primeira compra, grava `commissions` e credita `wallets` por `wallet_delta`/`ledger`, na mesma transação. Falha em qualquer passo deve reverter tudo. A comissão entra automaticamente no saldo disponível e pode ser usada em compras; saque segue as regras normais de saldo, produto elegível, limites e aprovação.

Proteções atuais: resultado idempotente em `app_requests`, unicidade em `commissions(user_id,source_user_id,level)` e `ledger.event_key` no formato `commission:COMPRADOR:NIVEL`. Testar duas conexões tentando a primeira compra simultaneamente e repetição do mesmo request_id. Uma operação financeira não pode ser duplicada nem deixar linha de comissão sem crédito correspondente no ledger.

Hoje `commissions` guarda recebedor, comprador de origem, nível, valor, posição vinculada e data; não guarda bps/base explicitamente. Para auditoria final, adicionar snapshots de percentual/base e identificador da compra/evento em migração nova, preservando créditos existentes. Na compra com múltiplas unidades, a referência atual aponta para a última posição criada, de igual preço; revisar a rastreabilidade do evento sem mudar a base de uma unidade. Não reconstruir taxas antigas por divisão de valor arredondado nem recalcular pagamentos a partir do catálogo ou das taxas atuais.

### Presentes, concessões e cancelamento

- Presente é pago pelo doador e pertence ao afiliado destinatário. Não gera comissão e não marca a primeira compra própria de nenhum dos dois. Receber presente não impede comissão se o destinatário realizar sua primeira compra própria depois.
- Concessão administrativa de produto também não gera comissão nem marca compra própria. Atualmente cria posição sem débito automático de compra; a responsabilidade financeira dessa concessão precisa ser revista pelo operador, inclusive a devolução de principal no vencimento. O motivo deve ficar na auditoria.
- Cancelar/pausar posição ou editar catálogo não reabre elegibilidade de primeira compra. O sistema não implementa estorno automático de comissão por cancelamento de produto. Se for necessário, definir política e lançar reversão idempotente/auditada; não apagar ledger nem resetar `first_purchase_at` para pagar de novo.

### Testes obrigatórios de comissão

`tests/commissions.test.mjs` executa as RPCs reais em PGlite e cobre três ancestrais, compra múltipla, repetição, novos descendentes, presentes/concessões, rollback, níveis inicialmente zero, arredondamento, preservação histórica e parâmetros forjados. Repita os casos com PostgreSQL hospedado e duas conexões. A suíte usa as taxas aprovadas de lançamento 15%/5%/2%; configurações alternativas, como níveis zero, são fixtures para validar a configuração administrativa, não padrões de lançamento. Na página Equipe, total geral, por nível e por afiliado devem coincidir com os registros de comissão e o extrato do recebedor.

## 2. Regras que devem permanecer coerentes em todas as páginas

| Área | Regra e experiência esperada | Referências do projeto |
| --- | --- | --- |
| Cadastro/login | Supabase Auth, confirmação/reenvio, recuperação e troca de senha/e-mail; referência preservada no cadastro; nenhum privilégio concedido por metadata. | `src/main.js`, `supabase/templates`, trigger de perfil |
| Perfil/tema | Nome, contato, senha/e-mail, avatar e tema claro/escuro; preferência persistente; contatos da equipe respeitam consentimento. | `src/main.js`, `src/style.css`, RPC de perfil |
| Dashboard | Nome/avatar, disponível/reservado, capital aplicado, rendimentos realizados e futuros; adicionar/sacar; banners rotativos e catálogo resumido. Capital devolvido fica separado de rendimento. | `stats`, `dashboard`, snapshot |
| Produtos | Produção e distribuição, preço à vista, taxa diária, prazo, detalhes e compra; saldo insuficiente abre recarga; sem teto vitalício de produtos. A RPC limita a 100 unidades por operação. | `productPage`, `productModal`, `purchase` |
| Meus produtos | Filtrar categoria, cada aquisição e quantidade, períodos pagos, vencimento, ganhos recebidos/restantes, capital a devolver/devolvido; recomendações por saldo e histórico. | `positionPage`, posições com snapshot de termos |
| Equipe | Três níveis, link/cópia, orientação de convite, nome/contato consentido, produtos/status, comissões, WhatsApp, doação e presente. | `teamPage`, `team_level`, `referred_by` |
| Doar saldo | Destinatário deve estar nos três níveis do doador; máximo agregado R$100 por doador/dia Brasília, somando todas as doações; debita um e credita outro atomicamente. Não gera comissão por si só. | `transfer`, `transfers`, ledger |
| Presentear | Apenas descendentes até nível 3; débito no doador, posição no destinatário, rendimentos e principal do contrato para o dono. Fluxo atual entrega diretamente, sem aceite. | `gift`, `payer_id`/`user_id` |
| Carteira | Recarga, QR/copia e cola, status, extrato, histórico de depósitos/saques/transferências; saldos e estados vindos do banco. | `payments`, `ledger`, `deposits`, `withdrawals`, `transfers` |
| Saques | R$30–R$10.000 solicitados, taxa 5% deduzida, uma solicitação por usuário/dia Brasília inclusive rejeitada, produto ativo ou concluído e saldo suficiente. | `withdrawal`, índice único de dia |
| Admin | Somente `profiles.is_admin IS TRUE` e `blocked IS FALSE`; catálogo, perfil/e-mail, saldo disponível auditado, posições, aprovações individuais/em lote/todos, rejeição, pausa, taxas do programa e auditoria. | wrapper RPC, `actor_admin`, `requireAdmin` |
| WhatsApp | Botão flutuante abre popup com link do grupo oficial; botões de contato abrem URL com número/mensagem. Sem envio automático. | `whatsapp_group`, URLs de contato |

Produção inicia com 10 períodos completos de 24h; distribuição com 15. Catálogo inicial usa 5%, 6%, 7%, 8% por categoria, a partir de 5%, e vem desativado para revisão/ativação. Preços e taxas/prazos por produto são editáveis. Devolução do valor investido está ativada para novas aquisições; cada posição guarda a política e condições no momento da compra. Não substituir contratos já existentes pelas configurações atuais.

Rendimento diário = `floor(principal_cents * daily_bps / 10000)` por unidade, sem juros compostos automáticos. Cron a cada cinco minutos verifica quantos períodos completos venceram desde `created_at`; não é pagamento à meia-noite nem cinco minutos de rendimento. Ao vencer, paga o último período e devolve integralmente o principal uma única vez se previsto no contrato. Exemplo: R$100 a 5% por 10 dias gera R$50 de rendimentos e devolve R$100, total de R$150. Compra de duas unidades tem duas posições/devoluções; principal e ganhos de presentes vão para o destinatário.

Pausa conserva a data original e recupera períodos vencidos ao reativar. Conta bloqueada atualmente interrompe o processamento de rendimentos, que pode recuperar o atraso quando liberada. Cancelamento não paga novos períodos nem devolve automaticamente compra ou comissão. A alteração específica de posição pelo admin exige motivo; preservar períodos já pagos e ledger.

Saldo mínimo/máximo de saque se refere ao **valor solicitado**, antes da taxa. Pedido mínimo R$30 envia R$28,50; pedido R$100 envia R$95; pedido R$10.000 envia R$9.500. A conta não pode gastar saldo reservado. Atualmente uma posição recebida de presente ou concedida pelo admin também atende ao critério de possuir produto; não exigir compra própria sem confirmação dessa mudança. A taxa de saque de 5% e os limites são regras fixas no código atual, diferentes das taxas editáveis de rendimento e comissão.

## 3. Contabilidade e pagamentos sem ambiguidade

Valores internos em centavos inteiros; gateway em reais decimais. Novos depósitos entre R$35 e R$5.000, conforme a regra aprovada. A quinta migração valida criação/alteração do valor por trigger e preserva a liquidação de depósitos legados abaixo de R$35 sem alterar seu valor; não bloquear esses créditos por aplicar o novo mínimo retroativamente. Crédito ao usuário é o valor bruto da cobrança confirmada; fee MercosulPay é custo separado do operador. A taxa operacional do provedor no saque também não é descontada novamente do usuário. `total_debit` é o campo de conciliação; `net_amount` de saque não é usado.

| Evento | Disponível | Reservado | Gatilho |
| --- | --- | --- | --- |
| Depósito R$100 completed | +R$100 | Sem alteração | Confirmação/consulta validada, `settle_deposit` |
| Compra R$100 | −R$100 | Sem alteração | RPC transacional de compra |
| Comissão R$15 | +R$15 | Sem alteração | Primeiro evento de compra elegível |
| Pedido de saque R$100 | −R$100 | +R$100 | Validação e reserva na RPC |
| Saque concluído | Sem novo débito | −R$100 | `settle_withdrawal`, Pix R$95 |
| Rejeição/recusa permanente desse saque | +R$100 | −R$100 | Liberação idempotente da reserva |
| Doação R$40 | −R$40 doador / +R$40 destinatário | Sem alteração | Transferência interna atômica |
| Último rendimento e principal | Crédito do último período + principal devido | Sem alteração | Vencimento da posição no cron |

Ledger é histórico de eventos, não campo editável de saldo. Use `available_delta` e `reserved_delta` para conciliar cada saldo. `amount_cents` pode descrever uma mudança de reserva, e não deve ser somado como se toda linha afetasse o disponível. Não ajustar saldo no navegador nem apagar movimentos para fazer o extrato fechar.

O saque passa por requested → approved → processing → completed, com rejected/failed/review conforme o caso. Aprovação, envio e confirmação são estados distintos. Rejeição administrativa atual atua sobre requested; saque já enviado/incerto conserva a reserva para conciliação. Pausar saques precisa bloquear novas solicitações e novos envios não iniciados, mantendo conciliação das operações enviadas. Testar mudança da configuração durante um lote.

O receiver de webhook valida HMAC/timestamp, deduplica delivery_id, grava inbox e confirma recepção rapidamente. O worker concilia posteriormente. Depósito necessita consulta validada completed; Pix emitido não gera saldo. Saque repete somente a mesma reference_id depois de falha incerta. Webhook/lista de cobranças ainda precisam de fixtures reais, pois o contrato fornecido omitiu envelopes completos. Não inventar GET withdrawals nem usar polling apertado no provedor.

## 4. Ajustes concretos identificados na revisão

Estes itens precisam de correção ou validação na continuação; não considerar todo comportamento da demonstração equivalente ao backend real.

| Prioridade | Evidência atual | Trabalho para Devin e aceite |
| --- | --- | --- |
| Alta | `store.action` gera novo request_id em toda chamada real. | Preservar o ID da intenção de compra/doação/solicitação e reutilizar após timeout; bloquear duplo envio. Diferenciar repetição de uma nova compra intencional. Testar cliente junto com a idempotência SQL. |
| Alta | `wallet_delta` registra amount negativo na reserva e na conclusão; `ledgerTable` mostra apenas amount. | Apresentar o extrato com semântica de disponível/reservado: conclusão não deve parecer um segundo débito do disponível. Reconciliar por deltas, preservando eventos existentes. |
| Alta | Comissões não guardam taxa/base explícitas por evento; a quinta migração audita a atualização das taxas para 15%/5%/2%. | Preservar as taxas aprovadas, configuráveis pelo admin, e a base de uma unidade mesmo em compra múltipla; acrescentar snapshot para eventos futuros sem reescrever créditos históricos. Testar nível 3 real e concorrência. |
| Alta | “Aprovar todos” monta IDs somente do snapshot carregado, limitado a 1000 saques. | Implementar seleção/batch server-side ou paginação que realmente cubra todos os requested com autorização e auditoria, sem reenviar saques em processamento. |
| Alta | Worker processa sequencialmente até 10 saques e 20 eventos; cada chamada de gateway pode esperar 20s. `payments` aguarda worker até 30s. | Limitar duração/lote, persistir progresso, reduzir trabalho por execução e retornar acionamento de forma coerente. Não prometer conclusão do lote por ACK; evitar ultrapassar limites de runtime ou perder reserva/lease em timeout. |
| Alta | Claim de saques verifica withdrawals_enabled no início do lote. | Conferir o efeito de uma pausa após claim e antes do envio de cada Pix. Não iniciar novos envios depois da pausa; continuar reconciliando os que já saíram. |
| Média | Cadastro com código inexistente resolve sponsor=null sem avisar. | Definir UX de referência inválida e impedir perda silenciosa de indicação quando código foi informado; preservar vínculo na confirmação/reenvio e redirecionamentos. Não inventar patrocinador. |
| Média | Equipe mostra botão WhatsApp sem número visível; resumo global não separa todos os totais por nível. | Mostrar contato consentido formatado, validar DDI em wa.me, resumos por nível e por afiliado; contatos sem consentimento permanecem ocultos. |
| Média | Equipe considera ativo apenas quem tem posição active; pedido original diz “tem produto”. | Definir se completed/paused contam como ativo e uniformizar rótulos, contadores e critérios, separados da elegibilidade para saque. |
| Média | `stats()` considera somente posições active como capital investido. | Definir capital comprometido versus total histórico; posição pausada ainda pode ter principal comprometido. Não tratar devolução de principal como rendimento. |
| Média | Transferências aparecem como descrições genéricas no ledger; snapshot não expõe histórico estruturado de transfers. | Exibir enviado/recebido, participante, valor, data e paginação por RPC autorizada, sem liberar acesso a movimentos de terceiros. |
| Média | Recomendações usam média de preços e um teto por saldo/histórico. | Conferir a experiência pedida de baratos/médios/caros e sugestões ocasionais de faixa superior; não sugerir compra como disponível sem saldo nem prometer retorno adicional. |
| Média | Helper de data usa locale pt-BR, mas não define timeZone; rodapé diz horário Brasília. | Fixar formatação America/Sao_Paulo onde prometido; manter armazenamento UTC e cálculo de períodos de 24h. Testar dispositivo em outro fuso e virada de dia do saque/doação. |
| Entrega | Bundle ainda contém modo demo, seed e textos de prévia. | Aplicar seção 8 do prompt, remover modo fictício do build público e adaptar testes. Configuração ausente não pode abrir conta demo nem confirmar Pix localmente. |

Sobre duração do worker: a [documentação oficial de limites](https://supabase.com/docs/guides/functions/limits), consultada em 07/10/2026, informa limite de duração de 150s no plano Free e 400s nos pagos, além de idle timeout de requisição de 150s. O limite interno de 30s do acionamento e o do `pg_net` também precisam ser considerados. Revalidar no plano instalado e desenhar lotes retomáveis; aumentar timeout isoladamente não resolve todas as camadas. [Agendamento oficial](https://supabase.com/docs/guides/functions/schedule-functions) orienta pg_cron/pg_net com Vault; validar status HTTP além do resultado do job.

## 5. Decisões do operador antes de ativar compras/saques

Registrar no relatório técnico, sem comentários de implantação nas telas públicas:

1. Regras já aprovadas: N1=15%, N2=5%, N3=2%, configuráveis pelo admin; comissão sobre uma unidade da primeira compra própria mesmo em compra múltipla; depósitos R$35–R$5.000 e saques R$30–R$10.000 com taxa de 5% (líquido mínimo R$28,50). Conferir a aplicação da quinta migração no ambiente, não reabrir essas regras como pendências nem usar taxas alternativas de fixtures como padrão.
2. Critério de ativo na equipe, tratamento de patrocinador bloqueado e recebimento de comissão sem produto próprio; política de reversão se houver cancelamento de compra/produto. Preservar comportamento existente enquanto não houver mudança aprovada.
3. Concessão administrativa e presente: entrega atual é imediata; definir eventual aceite e efeito financeiro de concessão sem débito, incluindo principal. Elegibilidade atual de saque aceita produtos desses fluxos.
4. Domínio EasyPanel, projeto Supabase, SMTP/remetente, conta admin do Eduardo, chave API MercosulPay/segredo do webhook, segredo worker e payloads reais. Valores reais de teste só com autorização do operador e por canal privado para os segredos.
5. Catálogo e descrições finais, grupo oficial Eletrify, conteúdo real de termos/privacidade e definições restantes do negócio. O grupo Renda Extra e percentuais da plataforma de referência não são automaticamente os da Eletrify.

Não transformar escolhas não confirmadas em “regras de Eduardo”. Se faltar um parâmetro, continuar tarefas independentes e registrar a pendência de ativação; não simular integração concluída nem publicar copy de processo ao cliente.

## 6. Ordem de execução e evidência para encerrar

1. Inventariar ambiente/schema e backup; conferir histórico e aplicar todas as migrações pendentes, incluindo a quinta `202610070001_launch_rules.sql`. Após as três primeiras faltam 004 e a quinta; após as quatro originais falta a quinta. Preservar as quatro originais. O instalador de banco novo reúne cinco migrações; instalação manual exige registrar somente as versões efetivamente aplicadas, incluindo a quinta apenas se executada. A quinta atualiza taxas com auditoria, valida novos depósitos por trigger preservando liquidações legadas de menor valor e ajusta constraint/RPC de saque para mínimo R$30. Para novas alterações, adicionar migração seguinte e regenerar o instalador, sem modificar migrações já aplicadas. Não inserir fixtures em produção.
2. Conferir comissões aprovadas 15%/5%/2% e base de uma unidade antes de permitir primeiras compras. Corrigir os itens de prioridade alta e manter testes de saldo, aquisição, comissão, saque, rendimento, permissões e idempotência.
3. Configurar Auth/SMTP/templates/redirects e promover somente o UUID confirmado pelo SQL do admin. Conferir RLS/grants, negação de auto-promoção, usuário comum em /admin, revogação com JWT ainda válido e conta bloqueada.
4. Publicar payments, mercosulpay-webhook e process-payments com seus secrets; cadastrar webhook real; obter/adaptar fixtures; configurar Vault/cron e verificar logs sem secrets. Não replicar lógica financeira no servidor frontend.
5. Verificar jornadas reais: cadastro por indicação, compra própria, compra múltipla, presente, doação, comissão dos três níveis, depósito confirmado, saque solicitado/aprovado/concluído/rejeitado, principal no vencimento e limites na virada de dia. Rodar operações concorrentes em duas conexões PostgreSQL.
6. Retirar demonstração e textos de processo, adaptar testes, validar temas/mobile/desktop e navegação, instalar Docker/EasyPanel porta 3000 com configuração pública runtime. Healthcheck não substitui teste de integração. Nenhum segredo em VITE, config.js, Git, HTML ou ZIP.
7. Rodar testes/build final; entregar domínio, commit, relação de SQL/functions/cron, parâmetros aprovados, evidências por fluxo e limitações reais remanescentes. Conferir ledger e reservas contra carteiras e saques abertos. Fazer ZIP final e atualizar todos os documentos.

Critério de conclusão: cada regra precisa de resultado observável, não apenas tela ou botão. PGlite/HTTP mocks/DOM são verificações locais, não prova de webhook, SMTP ou Pix hospedado. O relatório final deve diferenciar o que foi testado localmente, no ambiente hospedado e com dinheiro real autorizado.
