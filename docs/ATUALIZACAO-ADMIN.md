# Atualização do admin: paginação e perfis detalhados

Preparada sobre `daflones/projeto223k`, branch `main`, commit `19dd7e680803b02ffb3d09a51ab7810f0d2617a7`. O grupo novo e o aviso de cupom já estão publicados nessa base.

## O que está incluído

- Paginação no Supabase para usuários, catálogo, produtos dos usuários, saques, depósitos, cupons, auditoria e webhooks. Auditoria e webhooks têm controles independentes.
- Busca e filtros, contagem total, primeira/anterior/próxima/última página e opções de 10, 20, 50 ou 100 registros. As listas não ficam limitadas aos antigos 100, 500 ou 1.000 registros carregados pelo snapshot.
- O resumo administrativo consulta totais globais. A página exibida não altera o número de usuários, produtos, depósitos ou saques pendentes.
- Nome, e-mail e WhatsApp aparecem juntos na lista de usuários. O contato abre `wa.me` em outra aba.
- Perfil com saldo disponível/reservado, capital em produtos ativos, rendimentos, comissões recebidas, cadastro, confirmação de e-mail e indicador.
- Produtos do usuário com origem, capital, rendimento recebido, prazo, taxa, situação e devolução do capital.
- Equipe separada por níveis 1, 2 e 3, com busca, paginação, WhatsApp, produtos e comissão que cada afiliado gerou para o usuário selecionado. O botão **Ver todos** abre a lista completa de produtos daquele afiliado.
- Histórico de comissões com afiliado de origem, nível, produto, data e valor efetivamente creditado. É possível abrir o perfil do afiliado e ver as comissões recebidas por ele também.
- Edição de perfil, ajustes de saldo e concessão/edição de produtos continuam disponíveis.

**Resumo** e **Configurações** não são listas; os totais e o formulário ficam numa única tela.

## 1. Aplicar o SQL antes de publicar o frontend

No SQL Editor do **mesmo Supabase de produção**, execute o conteúdo de:

`supabase/migrations/202610100002_admin_pagination_and_profiles.sql`

No ZIP, o mesmo arquivo está na raiz como **`01-ATUALIZAR-ADMIN-SUPABASE.sql`**. Ele cria os índices e as consultas `admin_overview`, `admin_page` e `admin_user_profile`. Não concede recompensas, não debita saldos e não altera as regras financeiras. A helper `admin_team_members` é interna, sem permissão de execução pelos papéis da API.

O banco deve possuir as migrações anteriores do projeto, incluindo cupons e `202610090003_admin_position_counts.sql`. Se a pré-verificação indicar que falta uma delas, confira quais já foram aplicadas antes de conciliar o histórico com Devin.

**Não execute `INSTALAR_ELETRIFY.sql` no banco existente.** Esse instalador é destinado apenas a um banco novo. Não há necessidade de executar novamente o SQL anterior do grupo/cupom para esta atualização.

Se as migrações já são administradas pelo CLI, revise `supabase migration list` antes de `supabase db push`. Se executar o novo SQL manualmente num projeto que usa esse histórico, registre somente esta versão, após confirmar o sucesso da execução:

```sh
supabase migration repair 202610100002 --status applied
supabase migration list
```

Use o projeto remoto correto, já vinculado com `supabase link`. `migration repair` registra o histórico; ele não executa o conteúdo SQL.

Se o frontend receber “function not found” imediatamente após a criação das RPCs, confira a execução do SQL e a origem configurada. Se necessário, peça a atualização do cache do PostgREST no SQL Editor:

```sql
NOTIFY pgrst, 'reload schema';
```

## 2. Publicar a atualização

1. Baixe e extraia **todo** o ZIP novo em uma pasta própria. Ele contém o patch do admin, não as imagens completas, para manter o download pequeno.
2. Aplique o SQL descrito acima.
3. Execute `PUBLICAR-GIT.cmd` no Windows, com Git e Node.js 22 ou superior instalados.
4. O publicador baixa o repositório atual, aplica o patch, valida build/testes/interface/Edge Functions, faz commit e push para `main`.
5. Com Auto Deploy habilitado no serviço EasyPanel existente, acompanhe a implantação. Se o serviço exige acionamento manual, clique em **Deploy** após o push.

O domínio padrão para a conferência é `https://eletrify.me`. O publicador procura o identificador deste admin no JavaScript publicado; essa conferência não substitui a validação das RPCs com uma sessão real.

As variáveis, chaves e Edge Functions já existentes continuam sendo utilizadas. Esta alteração não exige nenhuma chave nova nem reimplantação de funções de depósitos/saques/webhooks.

Comandos opcionais:

```powershell
# Apenas aplicar os arquivos, sem commit/push/deploy
node .\PUBLICAR.mjs --apply-only

# Validar e criar commit local, sem push
node .\PUBLICAR.mjs --no-push

# Usar seu clone existente (deve estar sem alterações locais)
node .\PUBLICAR.mjs --repo "C:\caminho\projeto223k" --branch main

# Usar outro domínio para conferir o deploy
node .\PUBLICAR.mjs --site https://SEU_DOMINIO
```

O publicador não sobrescreve trabalho local desconhecido, não faz force push e permite retomar uma aplicação verificada interrompida. Se o patch conflitar com alterações posteriores no repositório, concilie com Devin antes de publicar.

Para identidade de commit ausente:

```powershell
git config --global user.name "Eduardo Daflon"
git config --global user.email "SEU_EMAIL_DE_COMMIT"
```

## 3. Como usar

Em **Administração → Usuários**, clique em **Perfil**. As abas são **Resumo**, **Produtos**, **Afiliados**, **Comissões** e **Editar perfil**. A equipe é sempre calculada em relação à pessoa selecionada, não em relação ao administrador conectado.

Na equipe, “com produto ativo” significa que há uma posição com status `active`. “Acesso suspenso” é uma indicação separada do bloqueio da conta.

As comissões exibidas são somadas a partir dos registros existentes em `commissions`. Alterar a taxa atual de comissão não recalcula valores históricos; consultar perfil/equipe não gera novos pagamentos. A comissão na linha do afiliado é quanto ele gerou **para a pessoa cujo perfil está aberto**. Para ver quanto o próprio afiliado recebeu, abra seu perfil.

Em **Saques**, a seleção vale para a página atual e é limpa ao mudar a página. **Aprovar todos pendentes** continua abrangendo o conjunto no servidor, incluindo outras páginas, e mostra o total global antes da confirmação. Busca e filtros não limitam essa ação global.

## 4. Conferência depois da publicação

- Entre com uma conta que possui `profiles.is_admin=true` e não está bloqueada; confira as abas e um perfil real.
- Entre com uma conta comum e confira a ausência de acesso ao admin. Revogar `is_admin` ou bloquear uma conta deve impedir a próxima consulta no backend, mesmo com a sessão anterior aberta.
- Navegue por primeira/próxima/última página, altere a quantidade por página e busque nome, contato e código de cupom.
- Confira um usuário com equipe nos três níveis; compare os valores do perfil com `commissions` e os contratos com `positions`, sem criar operações financeiras só para consultar dados.
- Confira perfis sem WhatsApp, sem indicador, sem produtos ou sem equipe, além dos temas claro/escuro e do layout no celular.
- Valide uma aprovação selecionada em ambiente de teste. Confira a confirmação global de **Aprovar todos**, sem executar Pix reais durante a conferência.
- Confirme que o grupo novo e o aviso de cupom permanecem funcionando como antes.

## Validação local

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run check:edge
```

Os testes de banco incluem 57 usuários, 1.107 saques, 605 depósitos, paginação acima dos limites antigos, busca literal, ordenação estável, total global, equipe até o terceiro nível, produtos além da primeira página, comissões históricas e negação para contas não autorizadas. Os fluxos DOM verificam todas as listas e a navegação de perfis. A validação em Supabase/EasyPanel hospedados deve ser feita após a publicação.

Referências oficiais: [migrações Supabase](https://supabase.com/docs/guides/deployment/database-migrations), [permissões de funções](https://supabase.com/docs/guides/database/functions) e [serviço App do EasyPanel](https://easypanel.io/docs/services/app).
