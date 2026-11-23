#!/usr/bin/env node
import { run } from './commands.js';

const code = await run(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
process.exitCode = code;
