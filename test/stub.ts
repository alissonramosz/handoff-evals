import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A fake OpenAI-compatible endpoint: it lets the tests run a "model" without a network or a key. */
export interface Seen {
  auth: string | undefined;
  body: { model: string; temperature: number; messages: { role: string; content: string }[] };
}

export interface Stub {
  url: string;
  seen: Seen[];
  maxInFlight(): number;
  close(): Promise<void>;
}

export type Reply = (message: string, attempt: number) => { status: number; body: unknown };

export const completion = (content: string) => ({ choices: [{ message: { content } }] });

export async function startStub(reply: Reply): Promise<Stub> {
  const seen: Seen[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  let max = 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Seen['body'];
      const message = body.messages[1]?.content ?? '';
      seen.push({ auth: req.headers.authorization, body });
      const attempt = (attempts.get(message) ?? 0) + 1;
      attempts.set(message, attempt);
      inFlight += 1;
      max = Math.max(max, inFlight);
      const out = reply(message, attempt);
      setTimeout(() => {
        inFlight -= 1;
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.body));
      }, 5);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    seen,
    maxInFlight: () => max,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
