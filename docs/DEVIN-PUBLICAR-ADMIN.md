# Devin: publicar e conferir paginação e perfis do admin

Trabalhe em `daflones/projeto223k`. A base desta atualização é `19dd7e680803b02ffb3d09a51ab7810f0d2617a7`, branch `main`. O usuário **já publicou o grupo novo e o aviso do cupom**. Preserve essa versão e aplique somente a atualização do admin fornecida neste pacote.

Leia `docs/ATUALIZACAO-ADMIN.md`, o patch e a migração `202610100002_admin_pagination_and_profiles.sql`. Se houver mudanças mais recentes, integre esta implementação na versão atual preservando o trabalho existente; não restaure uma versão antiga do projeto.

## Entrega esperada

1. Paginação no servidor em usuários, produtos, produtos dos usuários, saques, depósitos, cupons, auditoria e webhooks. Busca, filtros, total de registros, tamanho por página e ordenação estável. Auditoria e webhooks possuem paginação independente.
2. Perfil do usuário com WhatsApp/e-mail, saldo, capital ativo, rendimentos recebidos, comissões efetivamente recebidas, indicador e situação da conta.
3. Equipe relativa ao usuário selecionado nos níveis 1/2/3. Mostrar contatos, atividade, produtos e comissão que cada afiliado gerou para esse usuário. Abrir o perfil do afiliado permite consultar as próprias comissões dele.
4. Lista completa dos produtos de cada afiliado, paginada. A lista da equipe apresenta até três produtos por linha e **Ver todos**, sem ocultar os demais contratos.
5. Edição de usuário, ajustes auditados de saldo, concessão/edição de contratos e aprovações de saques continuam funcionais.

## Supabase e acesso

- Confirme o Supabase realmente usado pelo domínio EasyPanel e confira as migrações já instaladas. Aplique somente as versões pendentes; não execute o instalador de banco novo em produção.
- Aplique `202610100002_admin_pagination_and_profiles.sql` antes de publicar o frontend que chama as novas RPCs.
- Caso o SQL seja aplicado manualmente num projeto com histórico CLI, registre `202610100002` como aplicada **após** confirmar o sucesso da execução. Não marque migrações antigas como aplicadas sem conferir os objetos correspondentes.
- Valide `admin_overview`, `admin_page` e `admin_user_profile` via API com o JWT real de um administrador. Chamadas a partir do SQL Editor como postgres não validam a autenticação do navegador.
- `actor_admin()` deve consultar o valor atual de `profiles.is_admin` e `blocked`; não aceitar autorização por parâmetro, metadata de cadastro ou estado local.
- Confira negação para anônimo, conta comum, conta bloqueada e administrador cuja permissão foi revogada com JWT ainda válido. A helper `admin_team_members` deve permanecer interna e sem permissão de execução pelos papéis da API.
- Preserve RLS e as restrições de acesso direto às tabelas. Não inclua service-role ou chave MercosulPay no frontend.

## Comissões e dados financeiros

Esta atualização é de consulta; não modifica o cálculo nem cria pagamentos. As taxas aprovadas no projeto existente são 15%/5%/2%, configuráveis. A comissão é sobre uma unidade da primeira compra própria do afiliado, com idempotência; presente, cupom e concessão administrativa não geram comissão. Preserve os testes e a implementação existentes.

No perfil, some os registros reais de `commissions` por recebedor e por nível. Não multiplique os preços dos produtos pelas taxas atuais para reconstruir o histórico. A coluna de comissão na equipe filtra `user_id` pelo usuário selecionado e `source_user_id` pelo afiliado da linha. Não gere crédito ao carregar essas consultas.

Confirme que abrir perfis, mudar filtros e navegar nas páginas não altera saldo, ledger, contratos, comissões, depósitos, saques ou resgates. Capital a devolver/devolvido e rendimentos são exibidos separadamente. Preserve cron, devolução de principal, prazos contratados e os controles financeiros existentes.

**Aprovar selecionados** deve afetar somente IDs marcados na página atual. Trocar página limpa a seleção. **Aprovar todos pendentes** é uma ação global no servidor e exige a confirmação com total global; busca/filtro da lista não reduz seu alcance. Confira que os botões de aprovar, rejeitar e processar continuam respeitando as regras do backend. Não faça saques reais para provar paginação.

## Testar, publicar e entregar evidências

Execute nesta ordem:

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run check:edge
```

Depois, confira no navegador desktop e celular, temas claro/escuro, listas sem dados e listas maiores que uma página. Verifique perfil sem telefone/indicador/equipe, equipe nos três níveis, comissões filtradas e um afiliado com mais de 20 produtos. Confira busca em página posterior, filtros, tamanho de página e totais do resumo.

Faça commit e push dos arquivos desta atualização; publique no serviço EasyPanel já utilizado pelo projeto. Preserve porta, domínio e variáveis atuais. Não precisa criar novo serviço nem redeploy de Edge Functions para essa alteração.

O pacote possui `PUBLICAR.mjs` e `PUBLICAR-GIT.cmd`; pode utilizá-los ou aplicar o patch e executar os passos equivalentes. Se Auto Deploy estiver desativado, acione **Deploy** após o push e confira os logs. A conferência automatizada do domínio detecta `admin-pagination-2026-10-10-v1`, `admin_page` e `admin_user_profile` no bundle; valide também as consultas com a conta real.

Entregue o commit publicado, a migração aplicada, o resultado dos testes, evidências das telas e qualquer pendência observada no ambiente hospedado. Não declare deploy ou Pix concluídos apenas com testes locais. Os ajustes anteriores do grupo e cupom devem permanecer publicados; não envie benefícios novos aos usuários durante esta atualização.
