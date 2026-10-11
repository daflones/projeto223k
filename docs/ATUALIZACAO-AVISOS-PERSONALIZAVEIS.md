# Aviso da dashboard editável no admin

Atualização de `daflones/projeto223k`, branch `main`, preparada sobre o commit `d71f1ee6f8d9017dae1cf4f35449c1ec2eb7158a`. Essa base já contém a paginação e os perfis detalhados do admin, além do aviso do cupom.

## Mudanças

O aviso inicial passa a utilizar o grupo **https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni**. O link do botão flutuante da comunidade também é atualizado na instalação da migração.

Uma nova aba **Administração → Avisos** permite:

- Editar título e mensagem, incluindo quebras de linha.
- Inserir ou remover uma imagem por URL HTTPS ou caminho `/assets/...`, com descrição opcional.
- Adicionar, remover e ordenar até cinco botões, escolhendo texto, link HTTPS e estilo de destaque/secundário.
- Ativar ou desativar o aviso, escolher o popup automático e o cartão da dashboard.
- Editar o convite utilizado pelo botão flutuante de WhatsApp.
- Ver uma prévia do conteúdo antes de salvar e publicar novamente um aviso já existente.

O conteúdo é salvo no Supabase. Depois desta instalação, editar avisos pelo admin **não exige outro push/deploy**. Os usuários recebem o conteúdo atualizado na próxima consulta da dashboard: ao entrar, navegar para ela ou atualizar os dados.

## 1. Supabase existente

Execute **somente** esta nova migração no SQL Editor do projeto de produção:

`supabase/migrations/202610110001_customizable_dashboard_announcement.sql`

No ZIP, o mesmo conteúdo está como `01-ATUALIZAR-AVISOS-SUPABASE.sql`.

Ela cria `platform_announcements` e as RPCs `announcement_current`, `announcement_admin_get` e `announcement_admin_save`, com RLS e restrições de execução. A helper de validação de URL é interna. A migração exige a estrutura anterior do projeto.

A primeira aplicação instala o aviso e atualiza somente o campo `whatsapp_group` nas configurações. Reexecutar essa migração preserva o título, a mensagem, os botões e o grupo que você tiver editado depois pelo admin. Não altera saldo, compras, contratos, comissões, cupons, cron ou regras financeiras. Não é necessário redeploy de Edge Functions.

**Não execute o instalador completo em um banco existente.** Os SQLs anteriores de grupo/cupom e paginação não precisam ser reaplicados se já foram instalados.

Se o histórico remoto é gerenciado pelo Supabase CLI, confira as versões com `supabase migration list`. Depois de executar este SQL manualmente com sucesso, registre a versão no projeto remoto correto:

```sh
supabase migration repair 202610110001 --status applied
supabase migration list
```

`migration repair` registra o histórico, não executa o conteúdo SQL. Para um projeto já alinhado ao CLI, é possível aplicar as migrações realmente pendentes com `supabase db push` após revisar a lista.

Se as novas RPCs não aparecerem imediatamente na API depois da execução, confira o projeto configurado e peça a atualização do cache:

```sql
NOTIFY pgrst, 'reload schema';
```

## 2. Git e EasyPanel

1. Extraia todo o ZIP em uma pasta própria.
2. Execute o SQL acima no Supabase usado pelo domínio atual.
3. Com Git e Node.js 22+ instalados, execute `PUBLICAR-GIT.cmd`.
4. O publicador clona o repositório atual, aplica somente o patch desta atualização, executa build/testes/interface/Edge Functions, cria commit e faz push para `main`.
5. Acompanhe o Auto Deploy do serviço EasyPanel existente. Se ele for manual, clique em **Deploy** depois do push.

O publicador preserva alterações locais desconhecidas, não faz force push e permite retomar uma aplicação verificada interrompida. Se o repositório mudar e o patch entrar em conflito, peça ao Devin para conciliá-lo com a versão atual.

Opções:

```powershell
# Só aplicar os arquivos, sem commit/push/deploy
node .\PUBLICAR.mjs --apply-only

# Validar e criar commit local, sem push
node .\PUBLICAR.mjs --no-push

# Usar seu clone existente, sem alterações locais
node .\PUBLICAR.mjs --repo "C:\caminho\projeto223k" --branch main

# Conferir outro domínio após a publicação
node .\PUBLICAR.mjs --site https://SEU_DOMINIO
```

O ZIP contém o patch e os publicadores; o restante do código e as imagens são baixados do GitHub. Preserve as variáveis, o domínio e o serviço EasyPanel existentes. Nenhuma chave nova é necessária para esse recurso.

## 3. Editar o aviso

Abra **Administração → Avisos**, preencha o conteúdo e clique em **Salvar e publicar aviso**. Mensagens são texto simples; tags HTML são mostradas como texto, evitando inserir scripts na página.

O título aceita até 120 caracteres, a mensagem até 4.000 e cada botão até 60. Links de botões usam HTTPS. Para uma imagem, informe uma URL de imagem já hospedada ou um arquivo que existe no `/assets` do projeto; o campo não realiza upload de arquivos. Uma nova imagem colocada no repositório ainda precisa ser publicada, mas usar a URL de uma imagem já disponível não exige deploy.

O campo **Grupo oficial do WhatsApp** controla o botão flutuante. Os links dos botões do aviso são configurados separadamente, permitindo botões de grupo, suporte ou outras páginas.

Uma mudança no conteúdo ou nas opções de exibição cria uma nova versão. Quem já fechou a versão anterior verá a nova quando abrir a dashboard. Salvar conteúdo idêntico não cria outra versão. **Publicar novamente** permite reabrir o mesmo aviso para todos, após confirmação no admin.

A leitura é lembrada por usuário, navegador e versão. Em outro navegador o aviso pode aparecer novamente. O cartão, quando habilitado, permanece na dashboard mesmo depois de fechar o popup. Desativar o aviso oculta popup e cartão; o botão flutuante de WhatsApp continua disponível.

Se dois admins editarem a mesma versão, a segunda gravação é recusada: atualize a página para carregar a edição mais recente antes de salvar. A publicação é registrada na auditoria.

## 4. Conferir no ambiente publicado

- Acesse com `profiles.is_admin=true` e `blocked=false`; confirme a aba **Avisos** e o convite novo.
- Entre com uma conta comum e confira o popup com o botão correto. Feche e atualize: a mesma versão não deve reabrir naquele navegador.
- Salve um título/mensagem novos, imagem opcional e dois botões. Na conta comum, abra a dashboard novamente e confira conteúdo, imagem, ordem e links.
- Confira **Publicar novamente**, cartão sem popup, aviso desativado, remoção de imagem e ausência de botões.
- Valide negação de leitura pública anônima e edição por usuário comum, bloqueado ou admin cuja permissão foi revogada com a sessão ainda aberta.
- Confira celular e temas claro/escuro, além da preservação do aviso de cupom, paginação e perfis.

## Testes locais

Build de produção, 71 testes de banco/backend/servidor, fluxos DOM de interface e TypeScript das Edge Functions. Os novos testes cobrem autorização, persistência, versões, conflito de edição, links inválidos, texto escapado, imagem/botões, desativação e reaplicação do SQL sem sobrescrever personalizações ou alterar dados financeiros.

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run check:edge
```

A conferência com Supabase/EasyPanel hospedados ocorre após aplicar o SQL e publicar o frontend. Referências: [migrações Supabase](https://supabase.com/docs/guides/deployment/database-migrations), [funções e permissões](https://supabase.com/docs/guides/database/functions) e [serviço App do EasyPanel](https://easypanel.io/docs/services/app).
