import { ACTIONS, type Action, type Case, type Predicted } from './types.js';

export interface PredictOptions {
  /** Base URL of an OpenAI-compatible API, for example `https://api.openai.com/v1`. */
  baseUrl: string;
  model: string;
  /** Sent as a Bearer token when set. Never logged. */
  apiKey?: string;
  systemPrompt: string;
  cases: Case[];
  /** Requests in flight at the same time. Default 4. */
  concurrency?: number;
  /** Extra attempts after a timeout, HTTP 408, 429 or 5xx. Default 2. */
  retries?: number;
  /** Wait before the first retry; it doubles each time. Default 500. */
  retryDelayMs?: number;
  /** Default 60000. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}

export interface RawPrediction {
  id: string;
  action: Predicted;
  /** The model's reply, kept so you can read what it said. */
  raw: string;
}

/** A request error that retrying cannot fix, such as a wrong key or URL. */
class FatalRequestError extends Error {}

/** Put the business information into the prompt. A prompt without `{{business}}` is used as it is. */
export function buildSystemPrompt(template: string, business: string): string {
  return template.includes('{{business}}') ? template.replace('{{business}}', () => business.trim()) : template;
}

/** Read the `action` from a model reply: plain JSON, JSON in a code fence, or JSON inside text. */
export function parseAction(text: string): Predicted {
  const candidates: string[] = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as { action?: unknown };
      if (typeof value.action === 'string') {
        const action = value.action.trim().toLowerCase();
        return (ACTIONS as readonly string[]).includes(action) ? (action as Action) : 'invalid';
      }
    } catch {
      // not JSON: try the next candidate
    }
  }
  return 'invalid';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function complete(
  options: Required<Pick<PredictOptions, 'baseUrl' | 'model' | 'systemPrompt' | 'retries' | 'retryDelayMs' | 'timeoutMs'>> & {
    apiKey?: string;
    fetchImpl: typeof fetch;
  },
  message: string,
): Promise<string> {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const body = JSON.stringify({
    model: options.model,
    temperature: 0,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: message },
    ],
  });

  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await options.fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
      if (response.ok) {
        const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('the response has no choices[0].message.content text');
        return content;
      }
      const detail = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
      if (!(response.status === 408 || response.status === 429 || response.status >= 500)) {
        throw new FatalRequestError(detail);
      }
      lastError = detail;
    } catch (error) {
      if (error instanceof FatalRequestError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < options.retries) await sleep(options.retryDelayMs * 2 ** attempt);
  }
  throw new Error(`Request failed after ${options.retries + 1} attempts: ${lastError}`);
}

/**
 * Ask a model about every case through an OpenAI-compatible `/chat/completions` endpoint.
 * The first request error that retrying cannot fix stops the whole run.
 */
export async function predictAll(options: PredictOptions): Promise<RawPrediction[]> {
  const settings = {
    baseUrl: options.baseUrl,
    model: options.model,
    systemPrompt: options.systemPrompt,
    apiKey: options.apiKey,
    retries: options.retries ?? 2,
    retryDelayMs: options.retryDelayMs ?? 500,
    timeoutMs: options.timeoutMs ?? 60_000,
    fetchImpl: options.fetchImpl ?? fetch,
  };
  const { cases } = options;
  const results: RawPrediction[] = new Array<RawPrediction>(cases.length);
  let next = 0;
  let done = 0;
  let failure: Error | undefined;

  const worker = async () => {
    while (failure === undefined) {
      const index = next;
      next += 1;
      const current = cases[index];
      if (current === undefined) return;
      try {
        const raw = await complete(settings, current.message);
        results[index] = { id: current.id, action: parseAction(raw), raw };
        done += 1;
        options.onProgress?.(done, cases.length);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        return;
      }
    }
  };

  const workers = Math.max(1, Math.min(options.concurrency ?? 4, cases.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure !== undefined) throw failure;
  return results;
}
