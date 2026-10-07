# MercosulPay v1 — contrato e decisões

Contrato fornecido pelo Eduardo em 06/10/2026. A transcrição integral está em `MERCOSULPAY-CONTRATO-FORNECIDO.txt`.

- API `https://mercosulpay.com/api/public/v1`, JSON via HTTPS.
- Autorização Bearer exclusivamente em Edge Functions.
- Valores externos em BRL decimal; ledger e banco usam centavos inteiros.
- `POST /pix/charges`: amount, currency BRL, description, reference_id = UUID local. Sem payer_document/payer_name por padrão, mantendo cobrança aberta.
- Crédito apenas depois de status completed confirmado por `GET /pix/charges/{id}`. Valor bruto solicitado é creditado ao usuário; taxa da gateway é custo operacional separado.
- `POST /pix/withdrawals`: payout_cents convertido para BRL, chave, tipo, documento, reference_id = UUID do saque. Cada repetição usa a mesma referência idempotente.
- R$100 solicitados: reserva de R$100, taxa plataforma de R$5, envio Pix de R$95. Taxa da gateway não é descontada novamente do usuário. `total_debit` registra o custo total do provedor. `net_amount` de saque nunca usado.
- 401/403: análise/configuração, sem repetição automática. 422: recusa permanente; saque estornado uma vez. 429/502/timeout: manter reserva e retry do mesmo UUID após a janela de dez minutos. Cobrança não repetida porque idempotência de charge não foi documentada.
- Webhook: POST bruto; HMAC-SHA256(timestamp+'.'+body), assinatura sha256=hex minúsculo, tolerância 300s. Persistir delivery_id único, responder 2xx e processar via worker.

## Lacunas do contrato entregue
O JSON de webhook, o envelope da lista de cobranças e a resposta completa de saque não foram fornecidos. Adaptadores aceitam webhook no topo ou em `data`, lista como array, `data` ou `charges`. São hipóteses explícitas, não afirmações sobre a API. Se faltar id/reference_id/amount/total_debit, o evento fica em análise e nenhum saldo é alterado. Ajustar ao payload real em ambiente de teste e anexar fixtures.

Não existe endpoint de consulta de saque documentado no texto recebido. Não foi inventado. Repetir o POST idempotente com a mesma reference_id é o mecanismo de recuperação. Concluir apenas por resposta completed validada ou webhook pix.sent válido.

Conciliar charges em criação incerta usa apenas as 100 últimas; alto volume exige suporte do provedor a pesquisa/paginação. Não abrir outra cobrança enquanto a primeira estiver incerta. Em análise, investigar ID/referência e reprocessar a entrega pelo admin após confirmar os dados.
