#!/usr/bin/env node
// promptfoo `exec:` provider that asks a model the way `handoff-evals predict --exec` does.
//   exec:node provider-model.mjs <command that reads {"system","user"} on stdin and prints the reply>
// promptfoo appends three arguments after the ones in the config: the rendered prompt (the guest
// message), the provider options as JSON and the test context as JSON. Only the message is used here. The command is the
// same kind of command `predict --exec` takes; the default setup uses examples/openclaw-model.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../../dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
args.splice(-2); // options and context
const message = args.pop();
if (!message || args.length === 0) {
  console.error('Usage: provider-model.mjs <command...> <message>');
  process.exit(2);
}
const system = buildSystemPrompt(
  readFileSync(`${root}prompts/router.md`, 'utf8'),
  readFileSync(`${root}dataset/business.md`, 'utf8'),
);
const [file, ...fileArgs] = args;
const reply = execFileSync(file, fileArgs, {
  input: JSON.stringify({ system, user: message }),
  maxBuffer: 8 * 1024 * 1024,
  timeout: 180_000,
  cwd: root,
});
process.stdout.write(reply);
