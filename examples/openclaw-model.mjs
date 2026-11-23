#!/usr/bin/env node
// Example command for `handoff-evals predict --exec`: asks a model through the OpenClaw CLI.
//
//   handoff-evals predict --dataset realestate \
//     --exec "node examples/openclaw-model.mjs openrouter/google/gemini-2.5-flash-lite"
//
// It reads {"system": "...", "user": "..."} from stdin and prints the model's reply on stdout.
// The OpenClaw CLI takes one prompt, so the system prompt and the message go into one message.
// The API key stays in OpenClaw; this script never sees it. Any command that reads the same JSON
// and prints a reply works in its place.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [model, thinking] = process.argv.slice(2);
if (!model) {
  console.error('Usage: openclaw-model.mjs <provider/model> [thinking-level]');
  process.exit(2);
}

const { system, user } = JSON.parse(readFileSync(0, 'utf8'));
const prompt = `${system}\n\nMensagem do cliente:\n${user}`;
const args = ['infer', 'model', 'run', '--gateway', '--json', '--model', model, '--prompt', prompt];
if (thinking) args.push('--thinking', thinking);

execFile('openclaw', args, { maxBuffer: 8 * 1024 * 1024, timeout: 150_000 }, (error, stdout, stderr) => {
  if (error) {
    console.error((stderr || error.message).trim().slice(0, 300));
    process.exit(1);
  }
  let reply;
  try {
    reply = JSON.parse(stdout.slice(stdout.indexOf('{')));
  } catch {
    console.error('The OpenClaw reply is not JSON');
    process.exit(1);
  }
  const text = (reply.outputs ?? []).map((o) => o.text).filter(Boolean).join('\n');
  if (!reply.ok || !text) {
    console.error('The OpenClaw reply has no text');
    process.exit(1);
  }
  process.stdout.write(text);
});
