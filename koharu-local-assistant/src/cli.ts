import { KeychainStore, exclusively, hostConfig, saveHost } from './keychain.js';
import { SafeError } from './protocol.js';
import { availableModels, createSyntheticPlan } from './requests.js';
import { refreshed, selectedCredential, signIn, signOut } from './session.js';

const [command = 'help', ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => { const idx = args.indexOf(name); return idx < 0 ? undefined : args[idx + 1]; };
const help = `こはる珈琲 ローカル補助アプリ（macOS専用）
  signin [--plan] [--add-account]  本人認証。--planでプラン利用も許可
  status                         秘密を含まない接続状態
  accounts                       保存済み登録IDの一覧
  select --client-id <ID>         使用する登録を変更
  models                         プラン経路の対応モデル一覧（推論なし）
  plan --model <ID> --confirmed-plan-limit --credits-disabled
                                 公式設定の上限確認後、架空の運営相談を1回実行
  signout                        このMacの認証を削除し、更新セッションを失効

planは利用者の明示操作のみ。上限や追加クレジット設定をAPIから確認できないため、
ChatGPT設定→使用状況で、このアプリの上限と追加クレジット無効を確認するまで実行不可。`;

try {
  if (command === 'help') console.log(help);
  else if (command === 'accounts' || command === 'status') {
    const c = await hostConfig();
    if (command === 'accounts') console.log(JSON.stringify({ accounts: c.accounts.map(a => a.clientId), selected: c.active ?? null }, null, 2));
    else if (!c.active) console.log('未接続です。signinから始めてください。');
    else {
      let saved;
      try { saved = await new KeychainStore().load(c.active); } catch { /* Signed-out registrations retain metadata only. */ }
      console.log(JSON.stringify(saved ? { connected: true, clientId: saved.clientId, planPermission: saved.scopes.includes('chatgpt.tokens.use.direct'), accessExpiresAt: new Date(saved.expiresAt).toISOString(), storage: 'macOS Keychain', inferenceStarted: false } : { connected: false, selected: c.active, next: 'signin' }, null, 2));
    }
  } else if (command === 'select') await exclusively(async () => {
    const c = await hostConfig(); const selected = value('--client-id');
    if (!selected || !c.accounts.some(a => a.clientId === selected)) throw new SafeError('accountsにある登録IDを指定してください。');
    c.active = selected; await saveHost(c); console.log('使用する登録を変更しました。未接続の場合はsigninを実行してください。');
  });
  else if (command === 'signin') await exclusively(() => signIn(flag('--plan'), flag('--add-account')));
  else if (command === 'signout') await exclusively(() => signOut(new KeychainStore()));
  else if (command === 'models' || command === 'plan') await exclusively(async () => {
    // Check confirmation before refreshing credentials or making any inference request.
    if (command === 'plan' && (!flag('--confirmed-plan-limit') || !flag('--credits-disabled') || !value('--model'))) throw new SafeError('モデルと、公式設定で確認したプラン上限・追加クレジット無効の明示が必要です。helpを確認してください。');
    const store = new KeychainStore(); const credential = await refreshed(await selectedCredential(store), store);
    if (command === 'models') console.log(JSON.stringify(await availableModels(credential), null, 2));
    else console.log(JSON.stringify(await createSyntheticPlan(credential, { model: value('--model')!, confirmedPlanLimit: true, creditsDisabled: true }), null, 2));
  });
  else throw new SafeError('未知の操作です。helpを確認してください。');
} catch (error) {
  console.error(error instanceof SafeError ? error.message : '処理を完了できませんでした。秘密情報を含む詳細は表示していません。');
  process.exitCode = 1;
}
