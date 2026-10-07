// Execute the real TypeScript handlers with mocked HTTP dependencies. These
// tests prove handler behavior; they do not deploy Supabase or send real Pix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac, webcrypto} from 'node:crypto';
import ts from 'typescript';

globalThis.crypto ??= webcrypto;
const uid = '00000000-0000-4000-8000-000000000001';
const token = 'fixture-user-token';
const env = new Map(Object.entries({
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key',
  WORKER_SECRET: '0123456789abcdef'.repeat(4),
  MERCOSULPAY_API_KEY: 'fixture-gateway-key',
  MERCOSULPAY_WEBHOOK_SECRET: 'fixture-webhook-secret',
  APP_ORIGINS: 'https://app.example.test',
  APP_URL: 'https://app.example.test',
}));
let profile = {id: uid, is_admin: false, blocked: false};
let calls = [], events = [], withdrawal = null, raceDeposit = null;
let claimedWithdrawals = [], withdrawalsEnabledFlag = true, pauseOnSend = false;
const deliveries = new Set();
const json = (value, status = 200) => Response.json(value, {status});
const realFetch = globalThis.fetch;
const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  const headers = new Headers(init.headers);
  calls.push({url, method, body, headers});
  if (url.origin === 'https://mercosulpay.com' && raceDeposit) {
    assert.equal(url.pathname, '/api/public/v1/pix/charges');
    assert.equal(body.amount, raceDeposit.amount_cents / 100);assert.equal(body.reference_id, raceDeposit.id);
    // Simulate a successful webhook/worker settlement before create returns.
    raceDeposit.status = 'completed';raceDeposit.provider_id = 'charge-race';
    return json({id: 'charge-race', reference_id: raceDeposit.id, amount: raceDeposit.amount_cents / 100, status: 'pending', qr_code: 'fixture-qr'}, 201);
  }
  if (url.origin === 'https://mercosulpay.com' && url.pathname === '/api/public/v1/pix/withdrawals' && method === 'POST') {
    const response = json({id: 'provider-w-' + body.reference_id, reference_id: body.reference_id, amount: body.amount, total_debit: body.amount, status: 'pending'}, 201);
    if (pauseOnSend) withdrawalsEnabledFlag = false;
    return response;
  }
  if (url.origin !== env.get('SUPABASE_URL')) throw new Error(`Unexpected external call: ${url}`);
  if (url.pathname === '/auth/v1/user') {
    if (headers.get('authorization') !== `Bearer ${token}`) return json({message: 'Invalid JWT', code: 'bad_jwt'}, 401);
    // Deliberately spoof admin in user-editable metadata. It must be ignored.
    return json({id: uid, email: 'user@example.test', user_metadata: {is_admin: true}, app_metadata: {provider: 'email'}});
  }
  if (url.pathname === '/rest/v1/profiles') return json(profile);
  if (url.pathname === '/functions/v1/process-payments') return json({processed: 0});
  if (url.pathname === '/rest/v1/platform_settings') return json({withdrawals_enabled: withdrawalsEnabledFlag});
  if (url.pathname === '/rest/v1/rpc/claim_withdrawals') return json(claimedWithdrawals);
  if (url.pathname === '/rest/v1/rpc/claim_webhook_events') return json(events);
  if (url.pathname === '/rest/v1/rpc/settle_withdrawal') return json(null);
  if (url.pathname === '/rest/v1/deposits') {
    if (!raceDeposit) return json([]);
    if (method === 'POST') {raceDeposit.exists = true;return new Response(null, {status: 201});}
    if (method === 'PATCH') {
      assert.equal(url.searchParams.get('status'), 'in.(creating,review)');
      if (['creating', 'review'].includes(raceDeposit.status)) Object.assign(raceDeposit, body);
      // PostgREST object response for a zero-row PATCH; maybeSingle maps it to null.
      return json({code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested'}, 406);
    }
    if (url.searchParams.has('id')) return json(raceDeposit.exists ? raceDeposit : null);
    return json([]);
  }
  if (url.pathname === '/rest/v1/withdrawals') return json(withdrawal);
  if (url.pathname === '/rest/v1/webhook_inbox') {
    if (method === 'POST') {
      if (deliveries.has(body.delivery_id)) return json({code: '23505', message: 'Duplicate delivery'}, 409);
      deliveries.add(body.delivery_id);
    }
    return new Response(null, {status: 201});
  }
  throw new Error(`Unexpected Supabase call: ${method} ${url.pathname}`);
};
globalThis.fetch = mockFetch;
let activeHandler;
globalThis.Deno = {env: {get: key => env.get(key)}, serve: handler => {activeHandler = handler;}};
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compiled = source => ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
let backend = await readFile(new URL('../supabase/functions/_shared/backend.ts', import.meta.url), 'utf8');
backend = backend.replace('npm:@supabase/supabase-js@2.57.4', import.meta.resolve('@supabase/supabase-js'))
  .replace('./money.js', new URL('../supabase/functions/_shared/money.js', import.meta.url).href);
const backendUrl = dataUrl(compiled(backend));
async function handler(name) {
  let source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  source = source.replace('../_shared/backend.ts', backendUrl)
    .replace('../_shared/money.js', new URL('../supabase/functions/_shared/money.js', import.meta.url).href);
  await import(dataUrl(compiled(source)));
  return activeHandler;
}
const payments = await handler('payments');
const webhook = await handler('mercosulpay-webhook');
const worker = await handler('process-payments');
const request = (body, bearer = token) => new Request('https://supabase.example.test/functions/v1/payments', {
  method: 'POST', headers: {'content-type': 'application/json', ...(bearer ? {authorization: `Bearer ${bearer}`} : {})}, body: JSON.stringify(body),
});

test('Payments rejects missing/invalid JWT and metadata/body cannot grant admin', async () => {
  calls = [];
  assert.equal((await payments(request({action: 'process_approved'}, null))).status, 401);
  assert.equal((await payments(request({action: 'process_approved'}, 'invalid-token'))).status, 401);
  profile = {id: uid, is_admin: false, blocked: false};
  for (const action of ['process_approved', 'admin_update_email', 'admin_reset_password']) {
    assert.equal((await payments(request({action, user_id: uid, email: 'x@example.test', reason: 'Test reason', is_admin: true}))).status, 403);
  }
  assert(calls.every(c => c.method === 'GET'), 'Denied requests must not mutate data or trigger the worker');
});

test('Edge admin access follows the current database flag with the same JWT', async () => {
  calls = []; profile = {id: uid, is_admin: true, blocked: false};
  const result = await payments(request({action: 'process_approved'}));
  assert.equal(result.status, 200);assert.deepEqual(await result.json(), {queued: true});
  const invocation = calls.find(c => c.url.pathname === '/functions/v1/process-payments');
  assert.equal(invocation.headers.get('x-worker-secret'), env.get('WORKER_SECRET'));
  profile.is_admin = false;
  assert.equal((await payments(request({action: 'process_approved', is_admin: true}))).status, 403);
  profile = {id: uid, is_admin: true, blocked: true};
  assert.equal((await payments(request({action: 'process_approved'}))).status, 403);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('Payments rejects out-of-range deposit amounts before any database or gateway activity', async () => {
  for (const amount_cents of [3499, 500001, 0, -1, 3500.5, null, 'invalid']) {
    calls = [];
    const result = await payments(request({action: 'create_deposit', amount_cents, request_id: '00000000-0000-4000-8000-000000000020'}));
    assert.equal(result.status, 422);
    assert.deepEqual(await result.json(), {error: 'Depósito entre R$35 e R$5.000'});
    assert.equal(calls.length, 0, `Invalid amount ${amount_cents} must not make external calls`);
  }
});

for (const amount_cents of [3500, 500000]) {
  test(`Payments accepts the deposit boundary of ${amount_cents} cents`, async () => {
    calls = [];profile = {id: uid, is_admin: false, blocked: false};
    raceDeposit = {id: '00000000-0000-4000-8000-000000000020', user_id: uid, amount_cents, status: 'creating', exists: false};
    try {
      const result = await payments(request({action: 'create_deposit', amount_cents, request_id: raceDeposit.id}));
      assert.equal(result.status, 200);
      assert.equal((await result.json()).deposit.amount_cents, amount_cents);
      const inserted = calls.find(c => c.url.pathname === '/rest/v1/deposits' && c.method === 'POST');
      assert.equal(inserted.body.amount_cents, amount_cents);
      assert.equal(calls.filter(c => c.url.origin === 'https://mercosulpay.com').length, 1);
    } finally {raceDeposit = null;}
  });
}

test('Creating a Pix charge cannot regress a deposit completed by an earlier callback', async () => {
  calls = [];profile = {id: uid, is_admin: false, blocked: false};
  raceDeposit = {id: '00000000-0000-4000-8000-000000000020', user_id: uid, amount_cents: 10000, status: 'creating', exists: false};
  try {
    const result = await payments(request({action: 'create_deposit', amount_cents: 10000, request_id: raceDeposit.id}));
    assert.equal(result.status, 200);assert.equal((await result.json()).deposit.status, 'completed');
    assert.equal(raceDeposit.status, 'completed');
    assert.equal(calls.filter(c => c.url.origin === 'https://mercosulpay.com').length, 1);
  } finally {raceDeposit = null;}
});

test('Worker requires a configured secret before any database/gateway work', async () => {
  calls = []; const secret = env.get('WORKER_SECRET');
  const req = key => new Request('https://supabase.example.test/functions/v1/process-payments', {method: 'POST', headers: key ? {'x-worker-secret': key} : {}});
  assert.equal((await worker(req(null))).status, 403);
  assert.equal((await worker(req('wrong-secret'))).status, 403);
  env.set('WORKER_SECRET', 'SUBSTITUIR_POR_64_CARACTERES_ALEATORIOS');
  assert.equal((await worker(req(secret))).status, 503);
  assert.equal(calls.length, 0);
  env.set('WORKER_SECRET', secret);events = [];
  assert.equal((await worker(req(secret))).status, 200);
  assert(calls.some(c => c.url.pathname === '/rest/v1/rpc/claim_webhook_events'));
});

test('Webhook validates raw signature, acknowledges duplicates and never credits inline', async () => {
  calls = [];deliveries.clear();
  const raw = '{"data": {"id":"charge-1","reference_id":"reference-1","amount":12.34}}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'sha256=' + createHmac('sha256', env.get('MERCOSULPAY_WEBHOOK_SECRET')).update(timestamp + '.' + raw).digest('hex');
  const req = (body = raw, sig = signature, ts = timestamp) => new Request('https://supabase.example.test/functions/v1/mercosulpay-webhook', {
    method: 'POST', headers: {'x-mercosulpay-event': 'pix.received', 'x-mercosulpay-delivery': 'delivery-fixture', 'x-mercosulpay-timestamp': ts, 'x-mercosulpay-signature': sig}, body,
  });
  assert.equal((await webhook(req(raw, 'sha256=invalid'))).status, 401);
  assert.equal((await webhook(req(raw.replace(' ', '')))).status, 401);
  assert.equal((await webhook(req(raw, signature, String(Number(timestamp) - 301)))).status, 401);
  assert.equal(calls.length, 0);
  const secret=env.get('MERCOSULPAY_WEBHOOK_SECRET');env.set('MERCOSULPAY_WEBHOOK_SECRET','SUBSTITUIR');
  assert.equal((await webhook(req())).status,503);env.set('MERCOSULPAY_WEBHOOK_SECRET',secret);
  assert.equal(calls.length,0);
  assert.equal((await webhook(req())).status, 200);
  assert.equal((await webhook(req())).status, 200);
  assert.equal(deliveries.size, 1);
  assert(calls.every(c => c.url.pathname === '/rest/v1/webhook_inbox' && c.method === 'POST'));
});

test('Worker reconciles pix.sent using total_debit and records only its current lease', async () => {
  calls = []; withdrawal = {id: uid, payout_cents: 9500};
  events = [{delivery_id: 'sent-fixture', event: 'pix.sent', claim_token: 'lease-fixture', attempts: 1,
    payload: {data: {reference_id: uid, id: 'provider-withdrawal', amount: 95, total_debit: 96, net_amount: 999999}}}];
  const result = await worker(new Request('https://supabase.example.test/functions/v1/process-payments', {method: 'POST', headers: {'x-worker-secret': env.get('WORKER_SECRET')}}));
  assert.equal(result.status, 200);
  const settle = calls.find(c => c.url.pathname === '/rest/v1/rpc/settle_withdrawal');
  assert.deepEqual(settle.body, {p_id: uid, p_status: 'completed', p_provider_id: 'provider-withdrawal', p_total_debit: 9600});
  const saved = calls.find(c => c.url.pathname === '/rest/v1/webhook_inbox' && c.method === 'PATCH');
  assert.equal(saved.body.status, 'processed');
  assert.equal(saved.url.searchParams.get('claim_token'), 'eq.lease-fixture');
  events = [];withdrawal = null;
});

const workerReq = () => new Request('https://supabase.example.test/functions/v1/process-payments', {
  method: 'POST', headers: {'x-worker-secret': env.get('WORKER_SECRET')},
});
const sendCalls = () => calls.filter(c => c.url.origin === 'https://mercosulpay.com' && c.url.pathname === '/api/public/v1/pix/withdrawals');

test('Worker sends nothing while payouts are paused and the claimed row stays retriable', async () => {
  calls = []; events = []; deliveries.clear();
  claimedWithdrawals = [{id: uid, payout_cents: 5000, pix_key: '12345678900', pix_key_type: 'cpf', recipient_document: '12345678900', provider_id: null}];
  withdrawalsEnabledFlag = false;
  try {
    const paused = await worker(workerReq());
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).more, true);
    assert.equal(sendCalls().length, 0, 'Paused worker must not start gateway sends');
    assert.equal(calls.filter(c => c.url.pathname === '/rest/v1/rpc/settle_withdrawal').length, 0);
    assert(calls.some(c => c.url.pathname === '/rest/v1/platform_settings'), 'Per-item pause check must read platform_settings');
    withdrawalsEnabledFlag = true;
    const resumed = await worker(workerReq());
    assert.equal(resumed.status, 200);
    assert.equal(sendCalls().length, 1);
    assert.equal(sendCalls()[0].body.reference_id, uid);
    assert.equal(sendCalls()[0].body.amount, 50);
  } finally {claimedWithdrawals = []; withdrawalsEnabledFlag = true; events = [];}
});

test('Worker re-checks withdrawals_enabled before each send when the flag flips mid-run', async () => {
  calls = []; events = [];
  const w = id => ({id, payout_cents: 3000, pix_key: 'k', pix_key_type: 'cpf', recipient_document: 'doc', provider_id: null});
  claimedWithdrawals = [w('00000000-0000-4000-8000-000000000021'), w('00000000-0000-4000-8000-000000000022')];
  withdrawalsEnabledFlag = true; pauseOnSend = true;
  try {
    const result = await worker(workerReq());
    assert.equal(result.status, 200);
    assert.equal((await result.json()).more, true);
    assert.equal(sendCalls().length, 1, 'Second claimed withdrawal must not be sent after the pause');
    assert.equal(sendCalls()[0].body.reference_id, '00000000-0000-4000-8000-000000000021');
  } finally {claimedWithdrawals = []; withdrawalsEnabledFlag = true; pauseOnSend = false; events = [];}
});

test('Worker bounds sends and event processing per run and reports partial progress', async () => {
  calls = []; events = [];
  claimedWithdrawals = Array.from({length: 6}, (_, i) => ({id: `00000000-0000-4000-8000-00000000003${i}`, payout_cents: 3000, pix_key: 'k', pix_key_type: 'cpf', recipient_document: 'doc', provider_id: null}));
  withdrawalsEnabledFlag = true;
  try {
    const res = await worker(workerReq());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).more, true);
    assert.equal(sendCalls().length, 4, 'Sends must be capped below the wall-clock budget');
    const claim = calls.find(c => c.url.pathname === '/rest/v1/rpc/claim_withdrawals');
    assert.ok(claim.body.p_limit <= 4);
    calls = []; claimedWithdrawals = [];
    events = Array.from({length: 15}, (_, i) => ({delivery_id: `bounded-${i}`, event: 'unknown.event', claim_token: `lease-${i}`, attempts: 0, payload: {reference_id: uid}}));
    const res2 = await worker(workerReq());
    assert.equal(res2.status, 200);
    assert.equal((await res2.json()).more, true);
    const writes = calls.filter(c => c.url.pathname === '/rest/v1/webhook_inbox' && c.method === 'PATCH');
    assert.equal(writes.length, 10, 'Event processing must be capped per run');
    const eventClaim = calls.find(c => c.url.pathname === '/rest/v1/rpc/claim_webhook_events');
    assert.ok(eventClaim.body.p_limit <= 10);
  } finally {claimedWithdrawals = []; withdrawalsEnabledFlag = true; events = [];}
});

test.after(() => {globalThis.fetch = realFetch;delete globalThis.Deno;});
