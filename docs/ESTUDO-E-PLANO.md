# Eletrify — estudo consolidado

Referências: 44 capturas Nofy nos dois ZIPs, usadas somente para organização; repositório daflones/multicrypto commit b56d78f86e414926dafa682656c6b2621e6c96cb; kit Eletrify original e guia de imagens; contrato MercosulPay fornecido em 06/10/2026; documentação Supabase Auth/Edge/Cron.

Implementado: autenticação, Dashboard, produtos, meus produtos, equipe, carteira, perfil e administração. Backend PostgreSQL/RPCs/ledger; funções de pagamento, webhook/inbox/worker; cron e EasyPanel Docker. O repositório MultiCrypto permaneceu como apoio, sem copiar sua autenticação própria ou suas integrações DBXPay.

Visual: paleta #0B1220/#00D6A0/#38BDF8, logo original; navegação lateral desktop/inferior mobile; cards e formulários próprios. Produção/distribuição usa imagens conceituais de veículos e montagem. Não reutiliza a marca Nofy.

Condições iniciais atualizadas em 06/10/2026: produção com 10 dias, distribuição com 15 dias, taxas a partir de 5% e devolução integral do valor investido ao vencer o contrato. O catálogo inicial usa 5%, 6%, 7% e 8% por categoria; preços, taxas, prazos e política de devolução para novas compras são editáveis no admin. Capital devolvido e rendimentos ficam separados no extrato e nos indicadores. A terceira migração aplica esses padrões preservando contratos existentes e condições já personalizadas.

Operação real ainda depende da instalação no Supabase/EasyPanel, de credenciais/SMTP e das validações descritas no README e no prompt Devin. O catálogo vem desativado para ativação pelo operador; a demonstração usa saldos e créditos ilustrativos no navegador.

Admin e instalação: a quarta migração exige `profiles.is_admin IS TRUE` e conta não bloqueada, inclusive antes do retorno de requests administrativos idempotentes. O cadastro ignora metadata de função; tabelas não aceitam acesso direto do cliente. A interface redireciona usuários comuns ao abrir o admin. O pacote contém instalador SQL gerado das quatro migrações, script de promoção por UUID, configuração Vault/cron, consultas de verificação e guia `docs/INSTALACAO-SUPABASE.md`. Webhooks têm inbox com lease e resultados vinculados ao claim_token; handlers de cobrança preservam estados já conciliados.

Fontes técnicas: https://supabase.com/docs/guides/auth/auth-email-templates ; https://supabase.com/docs/guides/auth/passwords ; https://supabase.com/docs/guides/functions/auth ; https://supabase.com/docs/guides/cron/install .
