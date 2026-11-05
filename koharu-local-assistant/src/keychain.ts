import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SafeError, sameSecret, validClientId, type Credential } from './protocol.js';

const SERVICE = 'jp.koharu.local-assistant.credentials';
const DIRECTORY = join(homedir(), '.config', 'koharu-local-assistant');
export type CommandRunner = (args: string[], input?: string) => Promise<{ code: number; output: string }>;

/** Captures output in memory; callers must never forward security's raw output. */
export const runSecurity: CommandRunner = (args, input) => new Promise((resolve, reject) => {
  if (process.platform !== 'darwin') return reject(new SafeError('この補助アプリはmacOSのキーチェーンを必要とします。'));
  const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: Buffer[] = []; let bytes = 0;
  const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
  child.stdout.on('data', b => { bytes += b.length; if (bytes > 256_000) child.kill('SIGTERM'); else chunks.push(b); });
  child.stderr.resume(); // Raw stderr may echo submitted commands. Never print it.
  child.on('error', () => { clearTimeout(timer); reject(new SafeError('キーチェーンを開けませんでした。')); });
  child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, output: Buffer.concat(chunks).toString('utf8') }); });
  child.stdin.end(input);
});

function account(clientId: string): string {
  if (!validClientId(clientId)) throw new SafeError('登録先が不正です。');
  return createHash('sha256').update(clientId).digest('hex');
}
export class KeychainStore {
  constructor(private runner: CommandRunner = runSecurity) {}
  async save(credential: Credential): Promise<void> {
    const name = account(credential.clientId);
    const encoded = Buffer.from(JSON.stringify(credential)).toString('base64');
    if (encoded.length > 200_000) throw new SafeError('認証情報が大きすぎます。');
    // -i reads the command from stdin. No secret is present in argv, shell, env or a file.
    const result = await this.runner(['-i'], `add-generic-password -U -s ${SERVICE} -a ${name} -w ${encoded}\n`);
    if (result.code !== 0) throw new SafeError('キーチェーンに保存できませんでした。');
    const reread = await this.load(credential.clientId);
    if (!sameSecret(JSON.stringify(reread), JSON.stringify(credential))) throw new SafeError('キーチェーンへの保存を再確認できませんでした。');
  }
  async load(clientId: string): Promise<Credential> {
    const result = await this.runner(['find-generic-password', '-s', SERVICE, '-a', account(clientId), '-w']);
    if (result.code !== 0) throw new SafeError('保存された認証がありません。ログインしてください。');
    try {
      const value = JSON.parse(Buffer.from(result.output.trim(), 'base64').toString('utf8')) as Credential;
      if (value.clientId !== clientId || value.issuer !== 'https://auth.openai.com' || !value.subject || !Array.isArray(value.scopes) || typeof value.idToken !== 'string') throw new Error();
      return value;
    } catch { throw new SafeError('キーチェーンの登録情報を検証できませんでした。'); }
  }
  async remove(clientId: string): Promise<void> {
    const result = await this.runner(['delete-generic-password', '-s', SERVICE, '-a', account(clientId)]);
    if (result.code !== 0 && result.code !== 44) throw new SafeError('キーチェーンから削除できませんでした。');
  }
}

export type HostConfig = { schema: 1; hostId: string; accounts: { clientId: string; subject: string }[]; active?: string };
async function secureDirectory(): Promise<void> {
  await mkdir(DIRECTORY, { recursive: true, mode: 0o700 });
  const d = await lstat(DIRECTORY);
  if (!d.isDirectory() || d.isSymbolicLink() || (d.mode & 0o077) !== 0) throw new SafeError('設定フォルダーを本人だけが読める状態にしてください。');
}
export async function hostConfig(): Promise<HostConfig> {
  await secureDirectory();
  const path = join(DIRECTORY, 'host.json');
  try {
    const st = await lstat(path);
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077)) throw new SafeError('設定ファイルの権限が安全ではありません。');
    const value = JSON.parse(await readFile(path, 'utf8')) as HostConfig;
    if (value.schema !== 1 || !/^urn:uuid:[a-f0-9-]{36}$/.test(value.hostId) || !Array.isArray(value.accounts) || !value.accounts.every(a => a && validClientId(a.clientId) && typeof a.subject === 'string' && a.subject.length > 0 && a.subject.length < 1024) || (value.active && !value.accounts.some(a => a.clientId === value.active))) throw new Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new SafeError('ローカル登録設定を確認できませんでした。');
    const value: HostConfig = { schema: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
    try { await writeFile(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); return value; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return hostConfig(); throw e; }
  }
}
export async function saveHost(value: HostConfig): Promise<void> {
  await secureDirectory();
  const path = join(DIRECTORY, `host-${randomUUID()}.tmp`);
  try { await writeFile(path, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(path, join(DIRECTORY, 'host.json')); }
  finally { await unlink(path).catch(() => {}); }
}

/** Prevent concurrent refreshes from racing a rotating refresh token. */
export async function exclusively<T>(run: () => Promise<T>): Promise<T> {
  await secureDirectory();
  const lock = join(DIRECTORY, 'session.lock');
  try { await writeFile(lock, String(process.pid), { mode: 0o600, flag: 'wx' }); }
  catch { throw new SafeError('別の補助アプリが処理中です。同時にログインや更新をしないでください。'); }
  try { return await run(); } finally { await unlink(lock).catch(() => {}); }
}
