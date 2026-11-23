#!/usr/bin/env node
// promptfoo `exec:` provider for a reference baseline of handoff-evals.
//   exec:node provider-baseline.mjs <baseline-name>
// promptfoo appends three arguments after the ones in the config: the rendered prompt (the guest
// message), the provider options as JSON and the test context as JSON. Only the message is used here.
// stdout is the answer.
import { BASELINES } from '../../dist/index.js';

const args = process.argv.slice(2);
args.splice(-2); // options and context
const message = args.pop();
const name = args[0];
const baseline = BASELINES.find((b) => b.name === name);
if (!baseline) {
  console.error(`Unknown baseline "${name}". Use one of: ${BASELINES.map((b) => b.name).join(', ')}`);
  process.exit(2);
}
// The baselines only read the message text.
process.stdout.write(JSON.stringify({ action: baseline.predict({ message })}));
