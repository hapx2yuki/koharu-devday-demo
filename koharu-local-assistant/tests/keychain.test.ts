import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Readable } from 'node:stream';
import { ensureKeychainHelper, KeychainStore, runSecurity } from '../src/keychain.js';
import { ISSUER, type Credential } from '../src/protocol.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function credential(clientId: string, size: number): Credential {
  return {
    clientId, subject: 'synthetic-keychain-capacity-test', issuer: ISSUER,
    idToken: 'synthetic-' + 'a'.repeat(size), scopes: ['openid'],
    expiresAt: Date.now() + 60_000, savedAt: new Date().toISOString(),
  };
}

test('保存と再読取は同じ登録先を使い、秘密を引数に含めない', async () => {
  const value = credential('oaiapp_synthetic_unit', 16_384);
  let saved = '';
  const operations: string[] = [];
  const store = new KeychainStore(async (args, input) => {
    assert.equal(args.length, 2);
    assert.match(args[1]!, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(args).includes(value.idToken), false);
    operations.push(args[0]!);
    if (args[0] === 'set') { saved = input!; return {code: 0, output: ''}; }
    if (args[0] === 'delete') { saved = ''; return {code: 0, output: ''}; }
    return {code: 0, output: saved};
  });
  await store.save(value);
  const actual = await store.load(value.clientId);
  assert.equal(hash(JSON.stringify(actual)), hash(JSON.stringify(value)));
  await store.remove(value.clientId);
  assert.deepEqual(operations, ['set', 'get', 'get', 'delete']);
});

test('OSStatusを安全な失敗分類として返し、入力内容を表示しない', async () => {
  const value = credential('oaiapp_synthetic_failure', 16_384);
  const store = new KeychainStore(async () => ({code: -25308, output: ''}));
  await assert.rejects(store.save(value), error => error instanceof Error && error.message.includes('OSStatus -25308') && !error.message.includes(value.idToken));
  await assert.rejects(store.load(value.clientId), /OSStatus -25308/);
  await assert.rejects(store.remove(value.clientId), /OSStatus -25308/);
  await new KeychainStore(async () => ({code: -25300, output: ''})).remove(value.clientId);
});

test('20万バイトを超える保存値はネイティブ処理の前に拒否する', async () => {
  let calls = 0;
  const store = new KeychainStore(async () => { calls++; return {code: 0, output: ''}; });
  await assert.rejects(store.save(credential('oaiapp_synthetic_oversize', 200_001)), /大きすぎ/);
  assert.equal(calls, 0);
});

test('Swift補助プログラムをソース別の本人限定キャッシュで共有する', {skip: process.platform !== 'darwin'}, async () => {
  const paths = await Promise.all([ensureKeychainHelper(), ensureKeychainHelper()]);
  assert.equal(paths[0], paths[1]);
  const stat = await lstat(paths[0]!);
  assert.equal(stat.mode & 0o077, 0);
  assert.ok(stat.mode & 0o100);
  assert.equal(stat.isSymbolicLink(), false);
  const again = await ensureKeychainHelper();
  assert.equal((await lstat(again)).mtimeMs, stat.mtimeMs);
});

test('構築ロックのsymlinkとFIFOは読み取らず待機もせず拒否する', {skip: process.platform !== 'darwin'}, async () => {
  const execute = promisify(execFile);
  const source = await readFile(new URL('../src/keychain-helper.swift', import.meta.url));
  const digest = createHash('sha256').update(source).update(process.arch).digest('hex');
  const moduleUrl = new URL('../src/keychain.ts', import.meta.url).href;
  for (const kind of ['symlink', 'fifo']) {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'koharu-keychain-lock-'));
    try {
      const cache = join(isolatedHome, '.config', 'koharu-local-assistant', 'native', digest);
      await mkdir(cache, {recursive: true, mode: 0o700});
      const lock = join(cache, 'build.lock');
      if (kind === 'symlink') await symlink(join(isolatedHome, 'missing-target'), lock);
      else await execute('/usr/bin/mkfifo', ['-m', '600', lock]);
      const program = `import {ensureKeychainHelper} from ${JSON.stringify(moduleUrl)}; try {await ensureKeychainHelper(); process.exitCode=2;} catch(error) {console.log(error.message);}`;
      const started = Date.now();
      const result = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], {
        timeout: 3000,
        env: {PATH: process.env.PATH, HOME: isolatedHome},
      });
      assert.match(result.stdout, /構築中の記録を検証できません/);
      assert.ok(Date.now() - started < 3000);
      assert.equal(result.stderr, '');
    } finally {
      await rm(isolatedHome, {recursive: true, force: true});
    }
  }
});

test('実キーチェーンで16KBと128KBを保存・更新・再読取し、テスト項目を削除する', {skip: process.platform !== 'darwin'}, async () => {
  const clientId = `oaiapp_storage_test_${randomUUID().replaceAll('-', '')}`;
  const store = new KeychainStore();
  try {
    for (const size of [16_384, 131_072]) {
      const value = credential(clientId, size);
      await store.save(value);
      const actual = await store.load(clientId);
      assert.equal(hash(JSON.stringify(actual)), hash(JSON.stringify(value)));
    }
  } finally {
    await store.remove(clientId);
  }
  await assert.rejects(store.load(clientId), /OSStatus -25300/);
});

test('ネイティブ読取の内容はFD3だけに返し、標準出力はOSStatusだけにする', {skip: process.platform !== 'darwin'}, async () => {
  const account = hash(`synthetic-pipe-test-${randomUUID()}`);
  const encoded = Buffer.from('synthetic-' + 'z'.repeat(16_384)).toString('base64');
  try {
    assert.equal((await runSecurity(['set', account], encoded)).code, 0);
    const binary = await ensureKeychainHelper();
    const result = await new Promise<{code: number | null; stdout: string; stderr: string; secret: string}>(resolve => {
      const child = spawn(binary, ['get', account], {stdio: ['ignore', 'pipe', 'pipe', 'pipe']});
      let stdout = '', stderr = '', secret = '';
      child.stdout!.on('data', value => { stdout += value.toString(); });
      child.stderr!.on('data', value => { stderr += value.toString(); });
      (child.stdio[3] as Readable).on('data', value => { secret += value.toString(); });
      child.on('close', code => resolve({code, stdout, stderr, secret}));
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '0\n');
    assert.equal(result.stderr, '');
    assert.equal(hash(result.secret), hash(encoded));
  } finally {
    assert.equal((await runSecurity(['delete', account])).code, 0);
  }
});
