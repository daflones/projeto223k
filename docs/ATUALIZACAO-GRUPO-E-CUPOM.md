# Publicar os avisos da Eletrify

Atualização preparada sobre `daflones/projeto223k`, commit `83b47f54f3cb9fb45c4101aca5fc6f55ac826438`, branch `main`.

## O que muda

- Ao entrar na dashboard, uma conta conectada recebe o aviso: o grupo anterior será desativado após sofrer ataques. O botão abre `https://chat.whatsapp.com/BaQG9FSKZNYJXnJxNzVcyx` em outra aba.
- Fechar, pressionar Escape, clicar em Entendi ou entrar no grupo registra a leitura por conta e navegador. O aviso permanece acessível no cartão da dashboard. Em outro navegador o popup aparece novamente. Se o armazenamento estiver bloqueado, a leitura é mantida somente durante a visita.
- O cartão do cupom aparece apenas quando o Supabase confirma que a conta nunca resgatou `ELETRIFY`, o cupom está disponível e suas duas recompensas correspondem à oferta: R$5,00 de saldo ou produto com valor-base de R$10,00, taxa de 5% por 24h e duração de 10 dias. Somente uma opção pode ser selecionada.
- O botão abre as opções reais do cupom, sem digitar o código. O histórico é consultado novamente após o resgate, e o aviso desaparece. Isso funciona entre dispositivos e sessões.
- A consulta é privada: recebe o usuário de `auth.uid()`. A página não concede benefícios por conta própria; o resgate continua usando a RPC transacional existente.
- Se a consulta falhar, o cupom estiver esgotado/inativo/expirado ou os termos forem diferentes, o anúncio do cupom fica oculto e a dashboard continua funcionando.

## 1. Aplicar a atualização no Supabase existente

No SQL Editor do projeto Supabase usado em produção, execute somente:

`supabase/migrations/202610100001_community_and_welcome_notice.sql`

O pacote de publicação também inclui o mesmo conteúdo como `01-ATUALIZAR-SUPABASE.sql`, na raiz.

Esse SQL atualiza apenas o campo do grupo oficial, registra a alteração na auditoria e cria `welcome_coupon_status()`. Não concede saldo, não cria produtos, não muda regras de saque e não precisa reimplantar Edge Functions. Ele exige a migração de cupons `202610090002_coupons.sql`, já presente neste repositório.

Se o banco é gerenciado pelo Supabase CLI, confira o histórico com `supabase migration list` e aplique as migrações pendentes com `supabase db push`, revisando antes quais estão pendentes. Se aplicar o arquivo pelo SQL Editor em um banco com histórico CLI, registre essa versão como aplicada com `supabase migration repair 202610100001 --status applied`, depois de confirmar que o SQL terminou com sucesso no projeto correto.

`supabase/INSTALAR_ELETRIFY.sql` foi regenerado para instalações novas. Para a plataforma já instalada, utilize a migração específica acima.

## 2. Conferir o cupom no admin

Abra Administração → Cupons e confira `ELETRIFY`:

| Campo | Configuração |
| --- | --- |
| Ativo | Sim |
| Máximo de opções por resgate | 1 |
| Resgates por conta | 1 para um cupom de boas-vindas de uso único |
| Recompensa 1 | Saldo: R$5,00 |
| Recompensa 2 | Contrato exclusivo: valor-base R$10,00; 5% por 24h; 10 dias |
| Devolução do capital-base | Conferir a política da oferta; a UI de anúncio não promete uma condição diferente da configurada |
| Limite global/validade | Preservar os valores aprovados para a campanha e conferir que há resgates disponíveis |

Se ainda não existir, crie o cupom pelo admin com essas opções. O limite global precisa ser escolhido pelo operador conforme a campanha. Produtos exclusivos de cupons não entram no catálogo de compras.

Se um cupom existente tiver termos diferentes, preserve os contratos e resgates já registrados e revise a configuração com o responsável pelo banco. Este pacote não altera automaticamente as recompensas de cupons existentes.

## 3. Configurar o deploy do EasyPanel

No serviço que já hospeda a plataforma:

1. Source → GitHub: repositório `daflones/projeto223k`, branch `main`, Build Path `/`.
2. Build → Dockerfile na raiz. O Dockerfile existente faz o build e inicia `node server.mjs` na porta 3000.
3. Preserve as variáveis runtime `SUPABASE_URL` e `SUPABASE_ANON_KEY` já configuradas, assim como o domínio e a porta interna 3000.
4. Habilite Auto Deploy. Um push na branch configurada aciona a construção e implantação.

Se preferir iniciar manualmente, depois do push clique em Deploy e acompanhe os logs. Restart não reconstrói o código.

Referência oficial: https://easypanel.io/docs/services/app

## 4. Executar o publicador no Windows

Requisitos: Git para Windows, Node.js 22+ e uma conta GitHub com permissão de escrita no repositório. O Git pode abrir o login normal do gerenciador de credenciais.

Depois de aplicar o SQL e configurar o Auto Deploy, extraia o pacote e execute `PUBLICAR-GIT.cmd`. Ele clona a versão atual em `checkout-projeto223k`, confere a origem, aplica o patch, executa build/testes, cria o commit, faz push e consulta o domínio para verificar que o frontend contém os dois novos avisos.

Se precisar definir sua identidade de commit, use seus dados reais:

```powershell
git config --global user.name "Eduardo Daflon"
git config --global user.email "SEU_EMAIL_DE_COMMIT"
```

Para trabalhar em um clone existente:

```powershell
node .\PUBLICAR.mjs --repo "C:\caminho\projeto223k" --branch main --site https://eletrify.me
```

O publicador recusa alterações locais não reconhecidas e não usa force push. Se houver conflito com atualizações mais recentes, o patch não será aplicado; o código precisará ser conciliado nessa versão antes de publicar.

### Se a tentativa anterior parou no teste do instalador SQL no Windows

O erro `Generate the SQL bundle after editing migrations`, com diferenças entre `\r\n` e `\n`, é causado pelas quebras de linha do checkout no Windows. A versão corrigida normaliza apenas essas quebras de linha e continua verificando qualquer alteração no conteúdo SQL.

1. Extraia o ZIP corrigido na mesma pasta usada na tentativa anterior, substituindo os arquivos do pacote.
2. Preserve a pasta `checkout-projeto223k`: ela contém a atualização que já foi aplicada. Não é necessário apagar ou recriar esse checkout.
3. Execute novamente `PUBLICAR-GIT.cmd`. O publicador confere os arquivos da tentativa anterior, aplica a correção, executa as validações e continua com commit e push.

Se o SQL `01-ATUALIZAR-SUPABASE.sql` já foi aplicado com sucesso, esta correção não exige executar outro SQL no Supabase. Não execute o instalador completo em um banco existente.

Se você alterou os arquivos do checkout manualmente após a falha, o publicador interrompe a retomada para preservar essas alterações. Concilie os arquivos ou use outro checkout separado.

Opções úteis:

```powershell
# Aplicar os arquivos para revisão, sem commit, push ou deploy
node .\PUBLICAR.mjs --apply-only

# Validar e criar apenas o commit local
node .\PUBLICAR.mjs --no-push

# Usar um domínio diferente na conferência
node .\PUBLICAR.mjs --site https://SEU_DOMINIO

# Acionar deploy com o EasyPanel CLI já instalado e conectado
node .\PUBLICAR.mjs --easy-service nome-projeto/nome-servico --server production
```

O modo padrão usa o Auto Deploy do EasyPanel. `--easy-service` chama o CLI existente; configure o perfil do servidor pelos comandos fornecidos pelo seu painel. Referência: https://easypanel.io/docs/cli

A conferência do domínio confirma que o JavaScript publicado contém esta atualização. A validação do comportamento com contas reais e da migração no Supabase é a etapa seguinte.

## 5. Conferência após o deploy

1. Abra uma sessão já autenticada ou entre novamente e abra a dashboard. Confira o popup e o botão para o grupo novo.
2. Feche o popup, atualize a página e confira que ele não reaparece nessa conta/navegador. O cartão e o botão da comunidade permanecem disponíveis.
3. Entre com outra conta no mesmo navegador: o aviso deve aparecer para essa conta também.
4. Com uma conta que nunca resgatou `ELETRIFY`, confira o cartão do cupom e as duas alternativas.
5. Resgate uma alternativa e confirme o saldo ou o produto correspondente. Atualize a página e entre por outro dispositivo: o cartão do cupom deve permanecer oculto para essa conta.
6. Com uma conta que já tinha resgatado o cupom antes deste deploy, o cartão não deve aparecer.
7. Confira em celular e nos temas claro/escuro. Verifique também o botão flutuante de WhatsApp, cujo grupo configurado foi atualizado pelo SQL.

## Verificação local

Executar o build antes de `npm test`, porque o teste do servidor utiliza os arquivos em `dist`:

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run check:edge
```

Os testes cobrem consulta por conta, bloqueio de acesso anônimo/conta suspensa, reconhecimento de resgates anteriores, cupom desativado/ausente, termos da oferta, leitura persistida, isolamento entre contas, popup e o fluxo de seleção/resgate na interface. Eles não autenticam usuários no Supabase de produção nem fazem deploy no seu EasyPanel.
