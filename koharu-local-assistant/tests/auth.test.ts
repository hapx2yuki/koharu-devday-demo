import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { authorizationUrl, consumeCallback, createPending, beginPending, exchangeCode, validateTokens, PLAN_SCOPES, ISSUER, type Credential } from '../src/protocol.js';
import { KeychainStore } from '../src/keychain.js';
import { createSyntheticPlan } from '../src/requests.js';
import { signIn, type SignInDependencies } from '../src/session.js';

const host = 'urn:uuid:12345678-1234-4234-8234-123456789abc';
const clientId = 'oaiapp_test_registration';
const credential: Credential = { clientId, subject: 'synthetic-subject', issuer: ISSUER, idToken: 'test-id-token', accessToken: 'test-access-token', refreshToken: 'test-refresh-token', scopes: ['openid', ...PLAN_SCOPES], expiresAt: Date.now() + 3600_000, savedAt: new Date().toISOString() };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}
function localSignIn(overrides: Partial<SignInDependencies> = {}) {
  const ready = deferred<string>(), signals = new EventEmitter();
  const saved: Credential[] = [], hostWrites: string[] = [];
  let finished = false;
  const result = signIn(false, false, {
    readHost: async () => ({schema: 1, hostId: host, accounts: []}),
    saveCredential: async value => { saved.push(value); },
    writeHost: async value => { hostWrites.push(value.active!); },
    openBrowser: url => { ready.resolve(url); }, signals, ...overrides,
  }).then(() => ({error: undefined}), (error: Error) => ({error})).finally(() => { finished = true; });
  return {ready: ready.promise, signals, saved, hostWrites, result, finished: () => finished};
}
async function startCallback(origin: string) {
  const response = await fetch(new URL('/start', origin), {redirect: 'manual'});
  assert.equal(response.status, 302);
  const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
  const url = new URL('/auth/callback', origin);
  url.search = new URLSearchParams({state, code: 'synthetic-code', client_id: clientId}).toString();
  return url;
}

test('開始前の案内ページは交換を始めず、SIGINTで閉じる', async () => {
  let exchanges = 0;
  const session = localSignIn({exchange: async () => { exchanges++; return credential; }});
  const origin = await session.ready;
  assert.equal((await fetch(origin)).status, 200);
  session.signals.emit('SIGINT');
  assert.match((await session.result).error!.message, /終了/);
  assert.equal(exchanges, 0); assert.equal(session.saved.length, 0);
});

test('交換中に停止すると通信を中断し、callback終了まで待って保存を防ぐ', async () => {
  const entered = deferred<AbortSignal>(), exchange = deferred<Credential>();
  const session = localSignIn({exchange: async (_pending, _callback, signal) => { entered.resolve(signal); return exchange.promise; }});
  const url = await startCallback(await session.ready);
  const response = fetch(url);
  const signal = await entered.promise;
  session.signals.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true); assert.equal(session.finished(), false);
  exchange.resolve(credential);
  assert.equal((await response).status, 400);
  assert.match((await session.result).error!.message, /終了/);
  assert.equal(session.saved.length, 0); assert.equal(session.hostWrites.length, 0);
});

test('交換中の再開始と重複callbackを拒否し、元の認証を一度だけ保存する', async () => {
  const entered = deferred<void>(), exchange = deferred<Credential>(); let exchanges = 0;
  const session = localSignIn({exchange: async () => { exchanges++; entered.resolve(); return exchange.promise; }});
  const origin = await session.ready, url = await startCallback(origin), response = fetch(url);
  await entered.promise;
  assert.equal((await fetch(new URL('/start', origin), {redirect: 'manual'})).status, 409);
  assert.equal((await fetch(url)).status, 409);
  exchange.resolve(credential);
  assert.equal((await response).status, 200); assert.equal((await session.result).error, undefined);
  assert.equal(exchanges, 1); assert.deepEqual(session.saved, [credential]); assert.deepEqual(session.hostWrites, [clientId]);
});

test('保存開始後の停止はキーチェーンと選択情報の保存完了まで待つ', async () => {
  const entered = deferred<void>(), release = deferred<void>(), writes: string[] = [];
  const session = localSignIn({exchange: async () => credential, saveCredential: async () => { writes.push('keychain-start'); entered.resolve(); await release.promise; writes.push('keychain-done'); }, writeHost: async value => { assert.equal(value.active, clientId); writes.push('host-done'); }});
  const response = fetch(await startCallback(await session.ready));
  await entered.promise; session.signals.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.finished(), false); assert.deepEqual(writes, ['keychain-start']);
  release.resolve(); await response;
  assert.match((await session.result).error!.message, /終了/);
  assert.deepEqual(writes, ['keychain-start', 'keychain-done', 'host-done']);
});

test('案内ページを遅れて開いても認証を始めた時刻から5分間受け付ける', () => {
  const clickedAt = 3_600_000;
  const pending = beginPending(undefined, 12345, host, credential, clickedAt);
  assert.equal(pending.expiresAt, clickedAt + 300_000);
  assert.equal(pending.clientId, credential.clientId);
  assert.equal(pending.subject, credential.subject);
});

test('認証中の二度押しでstateや期限を変更しない', () => {
  const pending = beginPending(undefined, 12345, host, undefined, 1000);
  assert.equal(beginPending(pending, 12345, host, undefined, 2000), pending);
  assert.equal(pending.expiresAt, 301_000);
});

test('期限切れや処理済みの認証は新しいstateで始める', () => {
  const pending = beginPending(undefined, 12345, host, undefined, 1000);
  const expired = beginPending(pending, 12345, host, undefined, 301_000);
  assert.notEqual(expired.state, pending.state);
  assert.equal(expired.expiresAt, 601_000);
  expired.consumed = true;
  assert.notEqual(beginPending(expired, 12345, host, undefined, 302_000).state, expired.state);
});

test('初回登録はPKCE・state・nonce・固定hostを送り、credentialをURLに含めない', () => {
  const pending = createPending(12345, host);
  const u = new URL(authorizationUrl(pending, true));
  assert.equal(u.origin, ISSUER); assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:12345/auth/callback');
  assert.equal(u.searchParams.get('ext_agent_host_id'), host);
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.ok(!u.searchParams.has('code_verifier')); assert.ok(!u.searchParams.has('id_token_hint'));
  assert.ok(!u.toString().includes('test-access-token'));
  const next = createPending(12345, host, credential);
  const again = new URL(authorizationUrl(next, false));
  assert.equal(again.searchParams.get('client_id'), clientId); assert.ok(!again.searchParams.has('agent_name_hint'));
  assert.equal(again.searchParams.get('scope'), 'openid profile email');
  assert.notEqual(pending.state, next.state); assert.notEqual(pending.nonce, next.nonce);
});

test('state不一致・client差替え・期限切れ・二重callbackを拒否する', () => {
  const pending = createPending(12345, host, credential);
  const url = new URL(pending.redirectUri); url.search = new URLSearchParams({ state: 'wrong', code: 'x' }).toString();
  assert.throws(() => consumeCallback(pending, url), /一致/); assert.equal(pending.consumed, false);
  url.searchParams.set('state', pending.state); url.searchParams.set('client_id', 'oaiapp_wrong_registration');
  assert.throws(() => consumeCallback(pending, url), /登録先/);
  const expired = createPending(12345, host, undefined, 0);
  assert.throws(() => consumeCallback(expired, url, 301_000), /期限/);
  const valid = createPending(12345, host); const callback = new URL(valid.redirectUri);
  callback.search = new URLSearchParams({ state: valid.state, code: 'synthetic-code', client_id: clientId }).toString();
  assert.equal(consumeCallback(valid, callback).clientId, clientId);
  assert.throws(() => consumeCallback(valid, callback), /処理済み/);
});

test('重複パラメーターと認証拒否ではトークン交換へ進まない', () => {
  const p = createPending(23456, host); const u = new URL(p.redirectUri);
  u.search = new URLSearchParams({ state: p.state, code: 'x', client_id: clientId }).toString();
  u.searchParams.append('state', p.state); assert.throws(() => consumeCallback(p, u), /重複/);
  u.searchParams.delete('state'); u.searchParams.set('state', p.state); u.searchParams.set('error', 'access_denied');
  assert.throws(() => consumeCallback(p, u), /許可/);
});

test('OIDC署名・issuer・audience・nonce・アカウント一致を検証する', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test' }] });
  const p = createPending(23456, host, credential);
  const token = (overrides: Record<string, unknown> = {}) => new SignJWT({ nonce: p.nonce, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(ISSUER).setAudience(clientId).setSubject(credential.subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const good = { id_token: await token(), scope: 'openid profile email', expires_in: 3600 };
  assert.equal((await validateTokens(good, p, clientId, key)).subject, credential.subject);
  await assert.rejects(validateTokens({ ...good, id_token: await token({ nonce: 'wrong' }) }, p, clientId, key), /一致/);
  await assert.rejects(validateTokens(good, p, 'oaiapp_wrong_registration', key), /署名/);
  await assert.rejects(validateTokens(good, { ...p, subject: 'someone-else' }, clientId, key), /アカウント/);
  await assert.rejects(validateTokens({ ...good, scope: 'openid ' + PLAN_SCOPES.join(' ') }, p, clientId, key), /プラン利用/);
  const wrongIssuer = await new SignJWT({ nonce: p.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://wrong.example').setAudience(clientId).setSubject(credential.subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  await assert.rejects(validateTokens({ ...good, id_token: wrongIssuer }, p, clientId, key), /署名/);
  const expired = await new SignJWT({ nonce: p.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(ISSUER).setAudience(clientId).setSubject(credential.subject).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 100).sign(privateKey);
  await assert.rejects(validateTokens({ ...good, id_token: expired }, p, clientId, key), /署名/);
  const forged = good.id_token.slice(0, -8) + 'AAAAAAAA';
  await assert.rejects(validateTokens({ ...good, id_token: forged }, p, clientId, key), /署名/);
});

test('コード交換は発行済client IDとPKCEを正規endpointへPOSTする', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  const p = createPending(23456, host);
  const id = await new SignJWT({ nonce: p.nonce }).setProtectedHeader({ alg: 'RS256' }).setIssuer(ISSUER).setAudience(clientId).setSubject('demo').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let called = false;
  const fetcher: typeof fetch = async (url, init) => {
    called = true; assert.equal(url, `${ISSUER}/api/accounts/oauth/token`); assert.equal(init?.redirect, 'error');
    const b = init?.body as URLSearchParams; assert.equal(b.get('client_id'), clientId); assert.equal(b.get('code_verifier'), p.verifier); assert.equal(b.get('resource'), 'https://api.openai.com/v1');
    assert.ok(!b.has('client_secret')); return Response.json({ id_token: id, scope: 'openid' });
  };
  await exchangeCode(p, { clientId, code: 'synthetic' }, fetcher, key); assert.ok(called);
});

test('停止のAbortSignalをコード交換の通信へ渡す', async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException('Cancelled test request', 'AbortError');
  };
  await assert.rejects(exchangeCode(createPending(23456, host), {clientId, code: 'synthetic'}, fetcher, undefined, controller.signal), {name: 'AbortError'});
});

test('Keychainへの書込みはstdinだけに秘密を渡し、保存値を再読取する', async () => {
  let stored = ''; let writes = 0;
  const store = new KeychainStore(async (args, input) => {
    assert.ok(!JSON.stringify(args).includes(credential.accessToken!)); assert.ok(!JSON.stringify(args).includes(credential.refreshToken!));
    if (args[0] === '-i') { assert.ok(input); stored = input.match(/ -w ([A-Za-z0-9+/=]+)\n$/)![1]!; writes++; return { code: 0, output: '' }; }
    return { code: 0, output: stored + '\n' };
  });
  await store.save(credential); assert.equal(writes, 1); assert.deepEqual(await store.load(clientId), credential);
});

test('Keychainの成功応答だけでは保存成功とせず、以前の値を検出する', async () => {
  const old = Buffer.from(JSON.stringify({ ...credential, accessToken: 'old-token' })).toString('base64');
  const store = new KeychainStore(async args => ({ code: 0, output: args[0] === '-i' ? '' : old }));
  await assert.rejects(store.save(credential), /保存を再確認/);
});

test('上限未確認なら通信0回、上限確認後も正式completedがなければ成功にしない', async () => {
  let calls = 0; const noFetch: typeof fetch = async () => { calls++; throw new Error(); };
  await assert.rejects(createSyntheticPlan(credential, { model: 'gpt-6.1-sol', confirmedPlanLimit: false, creditsDisabled: true }, noFetch), /上限/); assert.equal(calls, 0);
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ models: [{ visibility: 'list', slug: 'gpt-6.1-sol', display_name: 'Sol' }] });
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.ok(Array.isArray(body.input));
    for (const key of ['max_output_tokens', 'previous_response_id', 'metadata', 'background', 'multi_agent', 'tools']) assert.ok(!(key in body));
    return new Response('data: {"type":"response.output_text.delta","delta":"途中"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  await assert.rejects(createSyntheticPlan(credential, { model: 'gpt-6.1-sol', confirmedPlanLimit: true, creditsDisabled: true }, fetcher), /完了結果/);
});

test('正式completed・visible text・利用量だけを返す', async () => {
  const fetcher: typeof fetch = async url => String(url).endsWith('/models') ? Response.json({ models: [{ visibility: 'list', slug: 'gpt-6.1-sol', display_name: 'Sol' }] }) : new Response([
    { type: 'response.output_text.delta', delta: '受注できます。' },
    { type: 'response.reasoning_text.delta', delta: 'nonpublic-never-copy' },
    { type: 'response.completed', response: { id: 'resp_synthetic', status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } } },
  ].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''));
  const result = await createSyntheticPlan(credential, { model: 'gpt-6.1-sol', confirmedPlanLimit: true, creditsDisabled: true }, fetcher);
  assert.equal(result.text, '受注できます。'); assert.equal(result.inputTokens, 10); assert.ok(!JSON.stringify(result).includes('nonpublic'));
});
