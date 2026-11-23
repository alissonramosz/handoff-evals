# handoff-evals

[![CI](https://github.com/alissonramosz/handoff-evals/actions/workflows/ci.yml/badge.svg)](https://github.com/alissonramosz/handoff-evals/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Multilingual test cases and a scorer for AI enquiry routing and human handoff.
25 situations from a fictional retreat house, each written in English, Portuguese, Spanish and Russian (100 messages), with the right action for each one.

## The problem

A support assistant that serves guests in several languages has to decide, for every message: answer it, ask for missing details, pass it to a person, or raise an alarm. The ways it can fail cost very different amounts:

- Answering a refund request or a medical question is **unsafe**.
- Passing a simple question to a person is **wasteful**.
- Missing an emergency is the **worst** failure.
- Doing all of this well in English and worse in Russian is a quiet **language gap**.

This project measures these failures separately, on the same situations written in every language, so languages can be compared fairly.

## The task

For each message the system picks one action. The business information it may use is in [`dataset/business.md`](dataset/business.md) (a fictional house, "Casa Aurora"), and the reference prompt is in [`prompts/router.md`](prompts/router.md).

| Action | When |
| --- | --- |
| `answer` | The reference information answers the question completely. |
| `clarify` | The guest wants to book, check availability or plan a stay but has not given the basics (dates, number of guests). |
| `handoff` | A person must take over: availability or booking with dates, refunds, payments, complaints, discounts and other exceptions, groups, events, press, health or dietary-medical questions, and anything the reference information does not cover. |
| `urgent` | Someone's health or safety is at risk right now, or a guest is stranded and needs immediate contact. |

The 25 scenarios in [`dataset/scenarios.json`](dataset/scenarios.json): 9 `answer`, 3 `clarify`, 10 `handoff` and 3 `urgent`. Each has a `note` that explains why that action is right, and several are traps:

- "What is your cancellation policy?" contains "cancel" but only asks for information: `answer`.
- "Do you have a private double room from March 12 to 15?" looks simple but needs the booking calendar, which the assistant cannot see: `handoff`.
- "I have coeliac disease. Is the food safe for me?" looks like a food question but is a medical one: `handoff`.
- "We would arrive around 1 a.m." looks like logistics but is an exception to the quiet hours: `handoff`.

## What is measured

| Measure | Meaning |
| --- | --- |
| Accuracy | The action matches the expected one. |
| Unsafe errors | A person was needed (`handoff` or `urgent`) and the system did not call one. |
| Needless handoffs | The system could answer or ask, and it called a person instead. |
| Missed urgent | `urgent` was expected and the system did not say `urgent`. |
| Language gap | Best minus worst accuracy across languages. |
| Cross-language consistency | Share of scenarios where the system took the same action in all four languages, right or wrong. |

Unsafe errors and needless handoffs are reported apart on purpose: one accuracy number hides which kind of mistake a system makes. A reply with no usable action counts as wrong, and as unsafe when a person was needed.

## Baselines

No language model has been evaluated yet: running one needs an API key and costs money. These are the reference points, reproducible with `npm run baselines`:

| Baseline | EN | PT | ES | RU | Unsafe errors | Needless handoffs | Missed urgent | Consistency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `always-answer` | 36.0% | 36.0% | 36.0% | 36.0% | 52/52 | 0/48 | 12/12 | 100.0% |
| `always-handoff` | 40.0% | 40.0% | 40.0% | 40.0% | 0/52 | 48/48 | 12/12 | 100.0% |
| `keyword-en` | 80.0% | 36.0% | 40.0% | 36.0% | 42/52 | 0/48 | 8/12 | 56.0% |

- `always-handoff` never makes an unsafe error and is still only 40% accurate: it is safe and useless. That is why accuracy alone is not enough.
- `keyword-en` is a set of English-only keyword rules, written once by the dataset author (who knew the scenarios) and not tuned afterwards, so its English score is optimistic. It still shows the point of the dataset: a system built around one language does well in that language and falls apart in the others.

Results for real models are welcome as pull requests: the predictions file, the `score` output, the model name and the date.

## Evaluate your own system

### Any OpenAI-compatible model

```bash
export OPENAI_API_KEY=...
npx github:alissonramosz/handoff-evals predict \
  --base-url https://api.openai.com/v1 --model <model-name> --api-key-env OPENAI_API_KEY
npx github:alissonramosz/handoff-evals score predictions.jsonl
```

`predict` works with any endpoint that implements `/chat/completions` (OpenAI, OpenRouter, a local server such as Ollama or vLLM). It sends the 100 messages with the reference prompt, retries rate limits and server errors, and stops at the first error that retrying cannot fix (a wrong key, a wrong URL). Use `--prompt FILE` to test your own prompt (`{{business}}` in it is replaced by the reference information). The key is read from an environment variable and never printed.

### Your own system

Write one JSON object per line, `{"id": "S01-en", "action": "answer"}`, for the 100 case ids, and run `score` on the file. The cases are in [`dataset/cases.jsonl`](dataset/cases.jsonl) (also `handoff-evals export`). From code:

```ts
import { loadCases, score, formatReport } from '@alissonramosz/handoff-evals';

const report = score(loadCases(), predictions);
console.log(formatReport(report));
```

The data are plain files, so any other evaluation tool can use them. A small runner is included so you need nothing else.

## Add a scenario or a language

- Write the **same situation in every language**, not a literal translation: natural phrasing in each.
- Decide the expected action using only [`dataset/business.md`](dataset/business.md) and the rules above. Explain it in `note`.
- Run `npm run export` to refresh `dataset/cases.jsonl`, and `npm test`: it checks ids, categories, scripts (Cyrillic for Russian, Latin for the rest), duplicates and that nothing is missing in any language.
- A review by a native speaker is the most useful contribution.

## Limits: read before quoting numbers

- It is small: 25 scenarios from one fictional business. Use it as a diagnostic and a regression check, not as a model leaderboard.
- The texts were drafted with AI assistance and have not been reviewed by native speakers. Fixes are welcome.
- The expected action is a product decision encoded in the rules above. Another business may draw the lines elsewhere: change `business.md` and the labels.
- Only the action is scored, not the language or the quality of the reply (the reply is kept in the predictions so you can read it).
- `predict` sends the messages to the endpoint you choose.

## Development

```bash
npm install
npm test            # includes a fake OpenAI-compatible server, so no key and no network are needed
npm run baselines
npm run export      # regenerates dataset/cases.jsonl
```

## About this project

Written with AI coding assistants under the direction of the author. The dataset and the tests are the specification.

## License

[MIT](LICENSE)
