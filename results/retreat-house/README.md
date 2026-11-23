# Recorded multilingual retreat-house batch

These are synthetic cases for the fictional Casa Aurora, not messages from real guests.
The [main README](../../README.md#model-results-multilingual-retreat-house) explains
the results and product implications. [`run.json`](run.json) records the source
commit, input/file hashes, requested model IDs and settings known at capture time.

## Files and provenance

- Four `*.jsonl` files: exactly one `{id, action, raw}` prediction per case, including
  the raw model reply. No replies were manually corrected.
- Four `*.score.json` files: the complete scorer output, including confusion matrices.
- One batch run per model, 100 messages each, on 23 November 2026. The earlier
  95/100 promptfoo smoke run is separate; this batch's 2.5 Flash Lite score is 94/100.
- The runner requested these model IDs through OpenRouter. The resolved provider
  version, actual token usage and billing are not available in these artifacts.
- The batch uses the v0.2.0 code and unchanged dataset/prompt. These result files
  were added to `main` after the v0.2.0 tag; the release tag was not rewritten.

## Recalculate a score (no model call)

From the repository root, after installing dependencies:

```bash
npm run build
node dist/cli.js score results/retreat-house/google_gemini-2.5-flash-lite.jsonl --json
```

Replace the filename with another model's JSONL to reproduce its saved score.
Recalculation is deterministic; a fresh inference run need not produce the same replies.

## Run fresh predictions (calls your configured provider)

The original batch used the equivalent of this command for each model ID:

```bash
node dist/cli.js predict --concurrency 3 --out predictions-new.jsonl \
  --exec "node examples/openclaw-model.mjs openrouter/google/gemini-2.5-flash-lite"
```

This needs your own configured OpenClaw/OpenRouter access and can incur charges.
The adapter places the reference prompt and message in one user message; temperature
and reasoning level were not explicitly set. Do not compare this directly with a
different transport, prompt, sampling configuration or provider-version pin without
recording those changes. The Portuguese separator is constant across languages.
