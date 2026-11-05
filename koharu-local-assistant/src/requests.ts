import { PLAN_SCOPES, RESOURCE, SafeError, type Credential } from './protocol.js';

export function assertPlanAccess(credential: Credential): void {
  if (!credential.accessToken || !PLAN_SCOPES.every(s => credential.scopes.includes(s))) throw new SafeError('プラン利用が許可されていません。signin --planで許可内容を確認してください。');
}
export function assertLimitsConfirmed(options: { confirmedPlanLimit: boolean; creditsDisabled: boolean }): void {
  if (!options.confirmedPlanLimit || !options.creditsDisabled) throw new SafeError('ChatGPTのこのアプリの利用上限と、追加クレジットが無効であることを公式設定画面で確認してから実行してください。');
}
export async function availableModels(credential: Credential, fetcher: typeof fetch = fetch): Promise<{ slug: string; name: string }[]> {
  assertPlanAccess(credential);
  const result = await fetcher(`${RESOURCE}/models`, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${credential.accessToken}` } });
  if (!result.ok) throw new SafeError(`モデルを取得できませんでした（HTTP ${result.status}）。`);
  const data = await result.json() as { models?: unknown };
  if (!Array.isArray(data.models)) throw new SafeError('対応モデルの応答形式を確認できませんでした。');
  return data.models.filter((m): m is { slug: string; display_name: string; visibility: string } => typeof m === 'object' && m !== null && typeof m.slug === 'string' && typeof m.display_name === 'string' && m.visibility === 'list').map(m => ({ slug: m.slug, name: m.display_name }));
}

export type PlanResult = { responseId: string; text: string; completed: true; inputTokens: number | null; outputTokens: number | null };
/** Never uses root API keys, hosted tools, background mode or unsupported quota fields. */
export async function createSyntheticPlan(credential: Credential, options: { model: string; confirmedPlanLimit: boolean; creditsDisabled: boolean }, fetcher: typeof fetch = fetch): Promise<PlanResult> {
  assertPlanAccess(credential); assertLimitsConfirmed(options);
  const models = await availableModels(credential, fetcher);
  if (!models.some(m => m.slug === options.model)) throw new SafeError('指定モデルはこのアカウントの一覧にありません。modelsで確認してください。');
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 120_000);
  try {
    const response = await fetcher(`${RESOURCE}/responses`, {
      method: 'POST', redirect: 'error', signal: abort.signal,
      headers: { Authorization: `Bearer ${credential.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model, store: false, stream: true,
        instructions: '架空の店の運営判断を日本語で200字以内にまとめる。与えられた数字のみを使い、実処理・連絡・購入を実行したとは書かない。',
        input: [{ role: 'user', content: 'こはる珈琲のイベント事前注文デモです。コーヒー在庫12杯、ラテ在庫6杯、受取枠の残りは14時が5件、14時30分が3件です。コーヒー2杯とラテ1杯の注文を1件受ける場合、在庫と枠に問題がないことを確認し、担当者向けに注意点をまとめてください。ここにあるデータはすべて架空で、実在顧客への連絡や決済はありません。' }],
      }),
    });
    if (!response.ok || !response.body) throw new SafeError(`プラン利用の実行を開始できませんでした（HTTP ${response.status}）。`);
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = ''; let bytes = 0; let text = ''; let result: PlanResult | undefined;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.length; if (bytes > 2_000_000) throw new SafeError('応答量が上限に達したため受信を停止しました。完了は確認できていません。');
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const payload = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
          if (!payload || payload === '[DONE]') continue;
          const event = JSON.parse(payload) as { type?: string; delta?: string; response?: { id?: string; status?: string; usage?: { input_tokens?: number; output_tokens?: number } } };
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
          if (['response.failed', 'response.incomplete', 'error'].includes(event.type ?? '')) throw new SafeError('プラン利用の応答は未完了です。利用枠と接続を確認してください。');
          if (event.type === 'response.completed') {
            if (!event.response?.id || event.response.status !== 'completed') throw new SafeError('完了した応答を確認できませんでした。');
            result = { responseId: event.response.id, text, completed: true, inputTokens: event.response.usage?.input_tokens ?? null, outputTokens: event.response.usage?.output_tokens ?? null };
          }
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!result || !result.text) throw new SafeError('接続が終了しましたが、正式な完了結果を取得できませんでした。自動再実行はしません。');
    return result;
  } catch (error) { if (error instanceof SafeError) throw error; throw new SafeError('プラン利用の応答を確認できませんでした。自動再実行はしません。'); }
  finally { clearTimeout(timer); }
}
