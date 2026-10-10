# Devin: publicar os avisos da comunidade e do cupom

Trabalhe no repositório `daflones/projeto223k` e preserve as alterações mais recentes do projeto. Aplique o patch do pacote sobre uma cópia atual do repositório, conferindo os conflitos antes de modificar os arquivos. Leia `docs/ATUALIZACAO-GRUPO-E-CUPOM.md`.

Objetivo: mostrar o aviso de mudança do grupo ao abrir a dashboard autenticada, com o link `https://chat.whatsapp.com/BaQG9FSKZNYJXnJxNzVcyx`, e anunciar `ELETRIFY` apenas para contas que nunca resgataram esse cupom. A oferta tem exatamente duas alternativas: R$5,00 de saldo ou produto de valor-base R$10,00, taxa de 5% ao dia e prazo de 10 dias. O usuário escolhe uma alternativa.

1. Confira o projeto Supabase associado ao ambiente de produção e seu histórico de migrações. Aplique `202610100001_community_and_welcome_notice.sql`. Se a base foi configurada manualmente, use somente essa migração sobre o esquema já existente e concilie o histórico do CLI. Não reaplique o instalador completo na base instalada.
2. Verifique `welcome_coupon_status()` sob JWT de um usuário comum, de alguém que já resgatou e de alguém bloqueado. Não aceite `user_id` enviado pelo navegador. O status deve consultar o histórico real e não registrar novos resgates. O resgate deve continuar pelos RPCs existentes, com limites e idempotência.
3. Confira no admin que `ELETRIFY` está ativo, disponível e tem as duas recompensas anunciadas, com `max_selections=1`. Preserve limites globais, contratos e resgates já aprovados. Se houver uma divergência nas recompensas de um cupom já utilizado, prepare a correção preservando o histórico e solicite ao operador somente a decisão de campanha que estiver faltando.
4. Preserve o Supabase, o gateway, as Edge Functions e as regras financeiras existentes. Esta atualização adiciona um RPC SQL de leitura e atualiza o link; não exige alterações nos handlers de depósitos/saques ou nos webhooks da MercosulPay.
5. Execute build, testes, smoke da interface e TypeScript das Edge Functions na ordem do guia. Faça QA no navegador para login e sessão persistida, Escape/fechamento do popup, contas diferentes no mesmo navegador, celular e temas claro/escuro.
6. Crie o commit e faça push na branch usada pelo serviço EasyPanel. Verifique se a origem é `daflones/projeto223k` e se o Auto Deploy está habilitado. Se necessário, acione Deploy manualmente pelo painel ou pelo CLI do servidor já conectado.
7. Confira os logs de build/runtime, `/api/health`, o JavaScript efetivamente servido e os dois fluxos em contas reais no domínio de produção. Só reporte deploy concluído depois de verificar a nova versão no domínio. Diferencie frontend publicado de migração/cupom ainda pendentes.

Entregue o hash do commit publicado, resultado do deploy, identificação da migração aplicada e os testes feitos com contas que resgataram/nunca resgataram. Não inclua senhas, chaves ou tokens no Git ou no relatório.

Compatibilidade com Windows: preserve a normalização de CRLF/LF no gerador e no teste do instalador SQL. Isso permite validar checkouts do Git para Windows sem ignorar mudanças reais no SQL. O publicador corrigido também pode retomar a tentativa anterior após conferir seus arquivos; veja o guia antes de alterar um checkout com publicação pendente.
