import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { KeychainStore, hostConfig, saveHost } from './keychain.js';
import { SafeError, authorizationUrl, consumeCallback, createPending, exchangeCode, RESOURCE, TOKEN, ISSUER, type Credential, type PendingAuth } from './protocol.js';

function openBrowser(url: string): void {
  // URL is loopback only, with no credentials or authorization parameters.
  const p = spawn('/usr/bin/open', [url], { stdio: 'ignore' });
  p.on('error', () => {});
}
const html = (body: string) => `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>こはる珈琲 補助アプリ</title><body><main><h1>こはる珈琲 補助アプリ</h1>${body}</main></body></html>`;

export async function signIn(plan: boolean, addAccount = false): Promise<void> {
  const config = await hostConfig(); const store = new KeychainStore();
  const previous = !addAccount && config.active ? config.accounts.find(a => a.clientId === config.active) : undefined;
  let pending: PendingAuth; let settled = false;
  let done!: () => void; let fail!: (e: Error) => void;
  const completion = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
    const host = `127.0.0.1:${port}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.method !== 'GET' || req.headers.host !== host || !req.url || req.url.length > 8192) { res.writeHead(400).end(html('<p>要求を受け付けられません。</p>')); return; }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/') {
      res.end(html(`<p>このMacのキーチェーンにだけ認証を保存します。工房やWebサーバーには渡しません。</p><p><a href="/start">Continue with ChatGPT</a></p><p>${plan ? '本人認証とChatGPTプラン利用の許可を確認します。' : '今回は本人認証だけを行います。'}</p>`)); return;
    }
    if (url.pathname === '/start' && !pending.consumed) {
      res.writeHead(302, { Location: authorizationUrl(pending, plan) }).end(); return;
    }
    if (url.pathname !== '/auth/callback' || settled) { res.writeHead(404).end(); return; }
    try {
      const callback = consumeCallback(pending, url);
      const credential = await exchangeCode(pending, callback);
      await store.save(credential);
      if (!config.accounts.some(a => a.clientId === credential.clientId)) config.accounts.push({ clientId: credential.clientId, subject: credential.subject });
      config.active = credential.clientId; await saveHost(config);
      settled = true; res.end(html('<p>認証を保存しました。この画面を閉じて補助アプリへ戻れます。</p>')); done();
    } catch (e) {
      res.writeHead(400).end(html('<p>認証を確認できませんでした。補助アプリからやり直してください。</p>'));
      if (pending.consumed) { settled = true; fail(e instanceof SafeError ? e : new SafeError('認証処理に失敗しました。')); }
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  pending = createPending(port, config.hostId, previous);
  console.log(`認証画面: http://127.0.0.1:${port}/`);
  openBrowser(`http://127.0.0.1:${port}/`);
  const timeout = setTimeout(() => fail(new SafeError('5分以内に認証が完了しませんでした。再度ログインしてください。')), 300_000);
  try { await completion; console.log('ChatGPTの本人確認を完了しました。推論はまだ実行していません。'); }
  finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}

export async function selectedCredential(store: KeychainStore): Promise<Credential> {
  const config = await hostConfig();
  if (!config.active) throw new SafeError('先にsigninを実行してください。');
  return store.load(config.active);
}
export async function refreshed(credential: Credential, store: KeychainStore): Promise<Credential> {
  if (credential.expiresAt > Date.now() + 60_000) return credential;
  if (!credential.refreshToken) throw new SafeError('認証期限が切れています。signin --planで再認証してください。');
  const response = await fetch(TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credential.clientId, refresh_token: credential.refreshToken, resource: RESOURCE }) });
  if (!response.ok) throw new SafeError('認証を更新できませんでした。signinで再認証してください。');
  const t = await response.json() as Record<string, unknown>;
  if (typeof t.access_token !== 'string' || !t.access_token || t.access_token.length > 50_000 || typeof t.refresh_token !== 'string' || !t.refresh_token || t.refresh_token.length > 50_000 || t.token_type !== 'Bearer' || typeof t.expires_in !== 'number' || !Number.isFinite(t.expires_in) || t.expires_in <= 0) throw new SafeError('更新された認証情報を検証できませんでした。');
  const scopes = typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : credential.scopes;
  // A refresh need not return an ID token. Retain the previously verified one; never trust an unvalidated replacement.
  const next = { ...credential, accessToken: t.access_token, refreshToken: t.refresh_token, scopes, expiresAt: Date.now() + t.expires_in * 1000, savedAt: new Date().toISOString() };
  await store.save(next); return next;
}
export async function signOut(store: KeychainStore): Promise<void> {
  const config = await hostConfig(); if (!config.active) return;
  const credential = await store.load(config.active); let revoked = !credential.refreshToken;
  if (credential.refreshToken) {
    try {
      const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const data = await discovery.json() as Record<string, unknown>;
      const endpoint = typeof data.revocation_endpoint === 'string' ? new URL(data.revocation_endpoint) : undefined;
      if (discovery.ok && data.issuer === ISSUER && endpoint?.origin === ISSUER) {
        const result = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credential.refreshToken, token_type_hint: 'refresh_token', client_id: credential.clientId }) });
        revoked = result.status === 200;
      }
    } catch { /* local removal still proceeds */ }
  }
  await store.remove(config.active);
  // Retain selected client/subject metadata so the next sign-in reuses the issued registration.
  await saveHost(config);
  console.log(revoked ? 'このMacの認証を削除し、更新セッションを終了しました。' : 'このMacの認証は削除しました。サーバー側の失効は確認できないため、ChatGPT設定から接続を解除してください。');
}
