import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
export const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
export const RESOURCE = 'https://api.openai.com/v1';
export const APP_NAME = 'こはる珈琲 ローカル補助アプリ';
export const IDENTITY_SCOPES = ['openid', 'profile', 'email'] as const;
export const PLAN_SCOPES = ['offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'] as const;

export class SafeError extends Error {}
export type PendingAuth = {
  state: string; nonce: string; verifier: string; redirectUri: string;
  hostId: string; expiresAt: number; clientId?: string; subject?: string; consumed: boolean;
};
export type Credential = {
  clientId: string; subject: string; issuer: string; idToken: string;
  accessToken?: string; refreshToken?: string; scopes: string[];
  expiresAt: number; savedAt: string;
};

const opaque = () => randomBytes(32).toString('base64url');
export function sameSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function validClientId(value: unknown): value is string {
  return typeof value === 'string' && value !== 'dynamic_agent_client' && /^[A-Za-z0-9_-]{6,180}$/.test(value);
}
export function createPending(port: number, hostId: string, selected?: Pick<Credential, 'clientId' | 'subject'>, now = Date.now()): PendingAuth {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^urn:uuid:[a-f0-9-]{36}$/.test(hostId)) throw new SafeError('ローカル認証設定が不正です。');
  if (selected && !validClientId(selected.clientId)) throw new SafeError('保存された登録情報が不正です。');
  return { state: opaque(), nonce: opaque(), verifier: opaque(), redirectUri: `http://127.0.0.1:${port}/auth/callback`, hostId, expiresAt: now + 300_000, consumed: false, ...(selected ? { clientId: selected.clientId, subject: selected.subject } : {}) };
}
export function authorizationUrl(pending: PendingAuth, plan: boolean): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: pending.clientId ?? 'dynamic_agent_client',
    ...(pending.clientId ? {} : { agent_name_hint: APP_NAME }),
    ext_agent_host_id: pending.hostId, response_type: 'code', redirect_uri: pending.redirectUri,
    scope: [...IDENTITY_SCOPES, ...(plan ? PLAN_SCOPES : [])].join(' '), resource: RESOURCE,
    state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
  }).toString();
  // id_token_hint is optional. Deliberately omit every token from browser URLs.
  return url.toString();
}
export function consumeCallback(pending: PendingAuth, incoming: URL, now = Date.now()): { clientId: string; code: string } {
  if (pending.consumed || now > pending.expiresAt) throw new SafeError('認証の待機期限が切れたか、既に処理済みです。');
  if (incoming.origin !== new URL(pending.redirectUri).origin || incoming.pathname !== '/auth/callback') throw new SafeError('認証の戻り先が一致しません。');
  for (const k of ['state', 'code', 'client_id', 'error']) if (incoming.searchParams.getAll(k).length > 1) throw new SafeError('重複した認証パラメーターを拒否しました。');
  const state = incoming.searchParams.get('state') ?? '';
  if (!sameSecret(state, pending.state)) throw new SafeError('認証要求が一致しません。');
  pending.consumed = true;
  if (incoming.searchParams.has('error')) throw new SafeError('ChatGPTで認証が許可されませんでした。');
  const receivedId = incoming.searchParams.get('client_id');
  const clientId = receivedId ?? pending.clientId;
  if (!validClientId(clientId) || (pending.clientId && receivedId && pending.clientId !== receivedId)) throw new SafeError('ChatGPTの登録先を確認できませんでした。');
  const code = incoming.searchParams.get('code');
  if (!code || code.length > 4096) throw new SafeError('認証コードを確認できませんでした。');
  return { clientId, code };
}

const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), { timeoutDuration: 10_000 });
export async function validateTokens(body: unknown, pending: PendingAuth, clientId: string, key: JWTVerifyGetKey = keys): Promise<Credential> {
  if (!body || typeof body !== 'object') throw new SafeError('認証応答を確認できませんでした。');
  const t = body as Record<string, unknown>;
  if (typeof t.id_token !== 'string' || t.id_token.length > 50_000) throw new SafeError('本人確認用の応答がありません。');
  let payload;
  try {
    ({ payload } = await jwtVerify(t.id_token, key, { issuer: ISSUER, audience: clientId, algorithms: ['RS256', 'ES256'], clockTolerance: 5, maxTokenAge: '10m', requiredClaims: ['sub', 'exp', 'iat', 'nonce'] }));
  } catch { throw new SafeError('本人確認用の署名・宛先・期限を検証できませんでした。'); }
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.nonce !== 'string' || !sameSecret(payload.nonce, pending.nonce)) throw new SafeError('本人確認の対象が一致しません。');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw new SafeError('本人確認の発行先が一致しません。');
  if (pending.subject && payload.sub !== pending.subject) throw new SafeError('選択したChatGPTアカウントと一致しません。');
  const scopes = typeof t.scope === 'string' ? [...new Set(t.scope.split(/\s+/).filter(Boolean))] : [];
  if (!scopes.includes('openid')) throw new SafeError('本人確認の許可を確認できませんでした。');
  const planAllowed = PLAN_SCOPES.every(s => scopes.includes(s));
  const safeToken = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 50_000;
  if (planAllowed && (!safeToken(t.access_token) || !safeToken(t.refresh_token) || t.token_type !== 'Bearer')) throw new SafeError('プラン利用の認証情報を確認できませんでした。');
  const expires = typeof t.expires_in === 'number' && Number.isFinite(t.expires_in) && t.expires_in > 0 ? t.expires_in : 0;
  return { clientId, subject: payload.sub, issuer: ISSUER, idToken: t.id_token, scopes, expiresAt: Date.now() + expires * 1000, savedAt: new Date().toISOString(), ...(typeof t.access_token === 'string' ? { accessToken: t.access_token } : {}), ...(typeof t.refresh_token === 'string' ? { refreshToken: t.refresh_token } : {}) };
}

export async function exchangeCode(pending: PendingAuth, callback: { clientId: string; code: string }, fetcher: typeof fetch = fetch, key: JWTVerifyGetKey = keys): Promise<Credential> {
  const response = await fetcher(TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }) });
  if (!response.ok) throw new SafeError(`認証交換に失敗しました（HTTP ${response.status}）。もう一度ログインしてください。`);
  return validateTokens(await response.json(), pending, callback.clientId, key);
}
