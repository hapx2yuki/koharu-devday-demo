import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, readFile, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { SafeError, sameSecret, validClientId, type Credential } from './protocol.js';

const DIRECTORY = join(homedir(), '.config', 'koharu-local-assistant');
const MAXIMUM_VALUE_BYTES = 200_000;
const HELPER_SOURCE = fileURLToPath(new URL('./keychain-helper.swift', import.meta.url));
export type CommandRunner = (args: string[], input?: string) => Promise<{ code: number; output: string }>;

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw new SafeError('キーチェーン補助プログラムの保存先が本人限定ではありません。');
}

async function executableExists(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || !(stat.mode & 0o100) || stat.uid !== process.getuid?.()) throw new SafeError('キーチェーン補助プログラムの権限が不正です。');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function compileHelper(source: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', output, '-framework', 'Security'], { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
    child.on('error', () => { clearTimeout(timer); reject(new SafeError('キーチェーン補助プログラムのコンパイラーを起動できませんでした。')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new SafeError(`キーチェーン補助プログラムを構築できませんでした（終了値 ${code ?? -1}）。`));
    });
  });
}

async function buildKeychainHelper(): Promise<string> {
  if (process.platform !== 'darwin') throw new SafeError('この補助アプリはmacOSのキーチェーンを必要とします。');
  const source = await readFile(HELPER_SOURCE);
  const digest = createHash('sha256').update(source).update(process.arch).digest('hex');
  await privateDirectory(DIRECTORY);
  const parent = join(DIRECTORY, 'native');
  await privateDirectory(parent);
  const directory = join(parent, digest);
  await privateDirectory(directory);
  const binary = join(directory, 'keychain-helper');
  const lockPath = join(directory, 'build.lock');
  const deadline = Date.now() + 65_000;
  for (;;) {
    if (await executableExists(binary)) return binary;
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: number;
      let reader;
      try {
        reader = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await reader.stat();
        if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid?.() || stat.size > 32) throw new SafeError('構築中の記録を検証できませんでした。');
        const buffer = Buffer.alloc(32);
        const result = await reader.read(buffer, 0, buffer.length, 0);
        const pid = buffer.subarray(0, result.bytesRead).toString('ascii');
        if (pid !== '' && !/^\d{1,10}$/.test(pid)) throw new SafeError('構築中の記録を検証できませんでした。');
        owner = Number(pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new SafeError('構築中の記録を検証できませんでした。');
        throw error;
      } finally {
        await reader?.close();
      }
      if (Number.isSafeInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') throw new SafeError('前回の補助プログラム構築が中断されています。構築ロックの確認が必要です。');
        }
      }
      if (Date.now() >= deadline) throw new SafeError('キーチェーン補助プログラムの構築待ちが期限を超えました。');
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    const suffix = randomUUID();
    const sourceCopy = join(directory, `build-${suffix}.swift`);
    const temporary = join(directory, `build-${suffix}`);
    try {
      await lock.writeFile(String(process.pid));
      if (await executableExists(binary)) return binary;
      await writeFile(sourceCopy, source, { mode: 0o600, flag: 'wx' });
      await compileHelper(sourceCopy, temporary);
      await chmod(temporary, 0o700);
      await rename(temporary, binary);
      await executableExists(binary);
      return binary;
    } finally {
      await lock.close();
      await Promise.all([unlink(sourceCopy).catch(() => {}), unlink(temporary).catch(() => {}), unlink(lockPath).catch(() => {})]);
    }
  }
}

let helperPromise: Promise<string> | undefined;
export function ensureKeychainHelper(): Promise<string> {
  helperPromise ??= buildKeychainHelper().catch(error => { helperPromise = undefined; throw error; });
  return helperPromise;
}

/** The child returns credentials only through the private descriptor 3 pipe. */
export const runSecurity: CommandRunner = async (args, input) => {
  if (args.length !== 2 || !['set', 'get', 'delete'].includes(args[0]!) || !/^[a-f0-9]{64}$/.test(args[1]!)) throw new SafeError('キーチェーン操作が不正です。');
  if (args[0] === 'set' && (!input || Buffer.byteLength(input) > MAXIMUM_VALUE_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(input))) throw new SafeError('保存する認証情報の形式か大きさが不正です。');
  if (args[0] !== 'set' && input !== undefined) throw new SafeError('キーチェーンの読取・削除には入力を渡せません。');
  const binary = await ensureKeychainHelper();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });
    const secretPipe = child.stdio[3] as Readable;
    const chunks: Buffer[] = [];
    let bytes = 0, statusText = '', failed = false;
    const stop = () => { failed = true; child.kill('SIGTERM'); };
    const timer = setTimeout(stop, 20_000);
    child.stdout!.on('data', (data: Buffer) => {
      statusText += data.toString('utf8');
      if (statusText.length > 32) stop();
    });
    secretPipe.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > MAXIMUM_VALUE_BYTES) stop();
      else chunks.push(data);
    });
    secretPipe.on('error', stop);
    child.stdin!.on('error', stop);
    child.on('error', () => { clearTimeout(timer); reject(new SafeError('キーチェーン補助プログラムを起動できませんでした。')); });
    child.on('close', code => {
      clearTimeout(timer);
      const status = statusText.trim();
      if (failed || !/^-?\d+$/.test(status) || !Number.isSafeInteger(Number(status)) || code !== (Number(status) === 0 ? 0 : 1)) return reject(new SafeError('キーチェーン補助プログラムの応答を検証できませんでした。'));
      resolve({ code: Number(status), output: Buffer.concat(chunks).toString('utf8') });
    });
    child.stdin!.end(input);
  });
};

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
    const result = await this.runner(['set', name], encoded);
    if (result.code !== 0) throw new SafeError(`キーチェーンに保存できませんでした（OSStatus ${result.code}）。`);
    const reread = await this.load(credential.clientId);
    if (!sameSecret(JSON.stringify(reread), JSON.stringify(credential))) throw new SafeError('キーチェーンへの保存を再確認できませんでした。');
  }
  async load(clientId: string): Promise<Credential> {
    const result = await this.runner(['get', account(clientId)]);
    if (result.code !== 0) throw new SafeError(`保存された認証を読み取れませんでした（OSStatus ${result.code}）。ログインしてください。`);
    try {
      const value = JSON.parse(Buffer.from(result.output.trim(), 'base64').toString('utf8')) as Credential;
      if (value.clientId !== clientId || value.issuer !== 'https://auth.openai.com' || !value.subject || !Array.isArray(value.scopes) || typeof value.idToken !== 'string') throw new Error();
      return value;
    } catch { throw new SafeError('キーチェーンの登録情報を検証できませんでした。'); }
  }
  async remove(clientId: string): Promise<void> {
    const result = await this.runner(['delete', account(clientId)]);
    if (result.code !== 0 && result.code !== -25300) throw new SafeError(`キーチェーンから削除できませんでした（OSStatus ${result.code}）。`);
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
