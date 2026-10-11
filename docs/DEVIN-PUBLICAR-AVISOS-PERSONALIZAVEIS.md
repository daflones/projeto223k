# Devin — aviso da dashboard personalizável

Repositório: `daflones/projeto223k`, branch `main`. Base do patch: `d71f1ee6f8d9017dae1cf4f35449c1ec2eb7158a`, que já contém a paginação e os perfis detalhados. Preserve as funcionalidades anteriores e concilie o patch com qualquer alteração posterior; não restaure um checkout antigo.

O usuário pediu atualizar o convite para **https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni** e editar o aviso pelo admin: título, mensagem, imagem, links e vários botões.

## Publicação

1. Leia `docs/ATUALIZACAO-AVISOS-PERSONALIZAVEIS.md` e revise os arquivos do patch.
2. Confirme o Supabase usado pelo serviço EasyPanel e o histórico de migrações. Aplique somente as versões que realmente faltam.
3. Aplique `202610110001_customizable_dashboard_announcement.sql` antes do frontend. Não execute o instalador de banco novo em produção. Se o SQL foi executado manualmente, registre essa versão no histórico CLI após confirmar sucesso.
4. Execute build, testes, interface e verificação das Edge Functions. Faça commit/push e deploy no serviço EasyPanel existente, preservando variáveis, porta e domínio.
5. Confira a UI e as RPCs com JWTs reais de admin/usuário. Chamadas do SQL Editor como postgres não comprovam as permissões da API.

## Recurso e comportamento

- Nova aba **Administração → Avisos**, com prévia, título/mensagem, imagem por URL ou `/assets`, até cinco botões ordenáveis e estilos destaque/secundário.
- Opções ativo, popup automático e cartão permanente. O convite do botão flutuante é editável no mesmo formulário, separado dos links de botões.
- `announcement_current()` entrega o aviso ativo a usuários autenticados e não bloqueados; aviso desativado retorna null.
- `announcement_admin_get()` e `announcement_admin_save()` exigem `actor_admin()` com a coluna atual `is_admin=true` e `blocked=false`.
- A publicação é salva no Supabase e auditada. Alterações futuras não exigem deploy. As telas consultam o conteúdo ao abrir/atualizar a dashboard.
- A leitura é armazenada por usuário/navegador/versão. Nova versão ou **Publicar novamente** faz o popup reabrir; salvar conteúdo idêntico não reabre.
- A gravação exige a versão lida pelo editor e trava o registro durante a atualização. Uma edição antiga não sobrescreve a publicação de outro admin.
- Título, mensagem e botões são escapados; mensagens não aceitam execução de HTML. URLs perigosas são recusadas no frontend e backend; links abrem em outra aba com `noopener noreferrer`.
- A instalação semeia o aviso/link uma vez. Reaplicar esse SQL depois não reverte os conteúdos ou o grupo editados pelo administrador.

## Validação necessária

Execute:

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run check:edge
```

Confira no navegador desktop/celular e temas claro/escuro: primeira abertura, fechamento, leitura persistida, edição de título com caracteres especiais e mensagem com quebras de linha, imagem opcional, vários botões, reordenação, salvar idêntico, nova publicação, aviso desativado, cartão sem popup e mensagem sem botões.

Confira negação para anônimo, conta comum, conta suspensa e admin revogado com JWT ainda válido. Preserve RLS e revogações de acesso direto à tabela/helper. Teste conflito de edição entre dois admins. Não coloque service-role ou chave de gateway no frontend.

Preserve cupom ELETRIFY, elegibilidade/resgates, perfil/equipe e paginação. Essa atualização não altera saldos, rendimentos, devolução de principal, comissões, Pix, webhooks, cron ou Edge Functions. Não gere benefícios, depósitos ou saques reais para testar o aviso. Não é necessário redeploy das funções financeiras.

Os marcadores de conferência do frontend são `dashboard-announcement-admin-2026-10-11-v1`, `announcement_current` e `announcement_admin_save`. Detectar esses marcadores não comprova que o Supabase remoto recebeu a migração; teste a consulta autenticada e a gravação pelo admin.

Entregue o commit publicado, a migração aplicada, o resultado dos testes e evidências das telas. Informe pendências reais sem declarar implantação concluída só com validações locais.
