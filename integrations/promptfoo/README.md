# handoff-evals in promptfoo

Runs the 100 `handoff-evals` cases inside [promptfoo](https://www.promptfoo.dev) and reproduces the `handoff-evals` score: accuracy overall and per language, unsafe errors, needless handoffs and missed urgent cases.
Use it when you already compare prompts and models in promptfoo and want these cases and measures there. The plain CLI (`predict`, `score`) does not need any of this.

Tested with promptfoo 0.126.0 and Node 24.

## Prerequisites

- A clone of this repository, built: `npm ci && npm run build` (the providers and the assertion read `dist/`).
- promptfoo, run with `npx promptfoo@latest` (or installed in a folder of your choice; nothing here changes this repository's `package.json`).

## Three commands

Run them from this folder (`integrations/promptfoo`): promptfoo runs the provider scripts from the config's folder.

```bash
# 1. The reference baselines. No model call, no cost.
npx promptfoo@latest eval -c promptfooconfig.yaml --no-cache --no-write --no-share -o results.json

# 2. The same numbers as the `handoff-evals` table, from the promptfoo results.
node report.mjs results.json

# 3. One real model (100 calls; it costs money). Edit the command in promptfooconfig.model.yaml first.
npx promptfoo@latest eval -c promptfooconfig.model.yaml -j 3 --no-cache --no-write --no-share -o model.json
```

promptfoo itself may check for updates and send usage data. `export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1` before the commands turns both off.

The numbers step 2 prints must equal the `npm run baselines` table in the repository root:

| Baseline | EN | PT | ES | RU | Unsafe errors | Needless handoffs | Missed urgent | Consistency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `always-answer` | 36.0% | 36.0% | 36.0% | 36.0% | 52/52 | 0/48 | 12/12 | 100.0% |
| `always-handoff` | 40.0% | 40.0% | 40.0% | 40.0% | 0/52 | 48/48 | 12/12 | 100.0% |
| `keyword-en` | 80.0% | 36.0% | 40.0% | 36.0% | 42/52 | 0/48 | 8/12 | 56.0% |

`report.mjs` lays them out differently: overall accuracy, plain counts (for example `42` unsafe errors, out of the 52 cases that needed a person) and no cross-language consistency, which `handoff-evals score` reports.

## How it works

- `tests.jsonl`: the 100 cases as promptfoo tests (`vars`: `message`, `expected`, `language`, `id`, `scenario`, `category`). A test checks that it matches `handoff-evals export`.
- `provider-baseline.mjs`: an `exec:` provider that answers like a baseline (`always-answer`, `always-handoff`, `keyword-en`).
- `provider-model.mjs`: an `exec:` provider that asks a model with the reference prompt and the reference information, through any command that reads `{"system","user"}` on stdin and prints the reply (the kind `predict --exec` takes). The default command is [`examples/openclaw-model.mjs`](../../examples/openclaw-model.mjs).
- `assert.mjs`: one `javascript` assertion. A case passes when the action equals the expected one. It also reports the named scores `correct`, `correct_<language>`, `unsafe_error`, `needless_handoff` and `missed_urgent`, so promptfoo's own summary adds them up per provider.
- `report.mjs`: prints the table above from a promptfoo results file, and with `--predictions <provider label>` writes a `predictions.jsonl` you can give to `handoff-evals score`, to check promptfoo against the scorer.

## What it does not cover

- Cross-language consistency (the same action in all four languages) and the confusion matrix: use `handoff-evals score`.
- The real-estate pack and its lead card.
- A promptfoo "passed" count is the number of correct actions, so "failed" is the number of wrong ones, and `promptfoo eval` exits with code 100 whenever any case fails (every baseline does).
- Model results here are one run, without repeats; the prompt reaches the model as the CLI example sends it (system prompt and message in one user message), not as a system role.
