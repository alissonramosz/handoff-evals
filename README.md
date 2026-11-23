# handoff-evals

[![CI](https://github.com/alissonramosz/handoff-evals/actions/workflows/ci.yml/badge.svg)](https://github.com/alissonramosz/handoff-evals/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Multilingual test cases and a scorer for AI enquiry routing and human handoff.
25 situations from a fictional retreat house, each written in English, Portuguese, Spanish and Russian (100 messages), with the right action for each one.
A second dataset, [for a real-estate agency in Brazilian Portuguese](#real-estate-pack-brazilian-portuguese), also scores the lead card the assistant fills in, and has results for four models.

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

No language model has been evaluated on this dataset yet (the [real-estate pack](#real-estate-pack-brazilian-portuguese) below has results): running one needs an API key and costs money. These are the reference points, reproducible with `npm run baselines`:

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

### In promptfoo

[`integrations/promptfoo`](integrations/promptfoo) runs the same 100 cases in [promptfoo](https://www.promptfoo.dev) and reproduces this score: accuracy per language, unsafe errors, needless handoffs and missed urgent cases.
It has a config for the baselines (no model, no cost) and one for a real model.
The baseline numbers it gives equal the ones above, and a test keeps the recipe in step with the dataset.

## Real-estate pack (Brazilian Portuguese)

A second dataset, for the first-line assistant of a made-up real-estate agency ("Imobiliária Modelo": no real company, no real customer). It has the same four actions and adds what makes lead handling useful: after every message the assistant also fills a **lead card**, and the card is scored too.

- 43 messages in informal Brazilian Portuguese: 7 `answer`, 8 `clarify`, 24 `handoff`, 4 `urgent`. Reference information: [`dataset/realestate/business.md`](dataset/realestate/business.md). Prompt: [`prompts/realestate.md`](prompts/realestate.md).
- The card has six fields: `goal`, `propertyType`, `regions`, `budget` (whole reais; rent is per month; the highest value of a range), `bedrooms` and `payment`. A field the message does not state must stay empty: filling it in counts as an **invented** value, and so does reading a hint as a choice ("não tenho fiador" is not `fiador`).
- Money is written the way people write it in Brazil: `R$ 3.500,00`, `1,8 mil`, `300k`, `uns 2 milhões`. The scorer reads a model's amount in any of these forms and compares numbers, not text.
- The rule behind `clarify` and `handoff`: a lead is qualified when it has a goal, a region and a budget (or a visit preference). A qualified lead goes to a broker, because the assistant has no listings; the others get a question. The dataset follows its own rule, and a test checks it.
- The lead card is scored per field (stated, correct, missed, wrong value, invented), then over the whole card.

```bash
npx github:alissonramosz/handoff-evals baselines --dataset realestate
export OPENROUTER_API_KEY=...
npx github:alissonramosz/handoff-evals predict --dataset realestate \
  --base-url https://openrouter.ai/api/v1 --model google/gemini-2.5-flash-lite --api-key-env OPENROUTER_API_KEY
npx github:alissonramosz/handoff-evals score predictions.jsonl --dataset realestate
```

The reference baselines are `always-answer` (16.3%, 28 of 28 unsafe errors) and `always-handoff` (55.8%, 15 of 15 needless handoffs).

### Results

Four Gemini models, asked on 23 November 2026 through OpenRouter with the pack's own prompt ([`prompts/realestate.md`](prompts/realestate.md)). One run per model, no repeats, temperature not set. The predictions, with the raw replies, are in [`results/realestate/`](results/realestate/). They were produced through [`examples/openclaw-model.mjs`](examples/openclaw-model.mjs), which sends the system prompt and the message as one user message; a run through `/chat/completions` will differ a little.

**Decision** (the baselines get 16.3% and 55.8%):

| Model | Action accuracy | Unsafe errors | Needless handoffs | Missed urgent | Unusable replies |
| --- | --- | --- | --- | --- | --- |
| `google/gemini-2.5-flash-lite` | 95.3% (41/43) | 1/28 | 1/15 | 0/4 | 0 |
| `google/gemini-2.5-flash` | 95.3% (41/43) | 2/28 | 0/15 | 0/4 | 0 |
| `google/gemini-3.1-flash-lite` | 90.7% (39/43) | 4/28 | 0/15 | 0/4 | 0 |
| `google/gemini-3.5-flash-lite` | 95.3% (41/43) | 0/28 | 2/15 | 0/4 | 0 |

**Lead card** (each cell is correct values / fields the messages state; "invented" counts fields a message does not state that the model filled in):

| Model | Goal | Property type | Regions | Budget | Bedrooms | Payment | All six right | Invented values |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `google/gemini-2.5-flash-lite` | 29/29 | 23/23 | 14/14 | 14/14 | 10/10 | 7/7 | 81.4% (35/43) | 8/161 |
| `google/gemini-2.5-flash` | 24/29 | 22/23 | 14/14 | 14/14 | 10/10 | 7/7 | 86.0% (37/43) | 0/161 |
| `google/gemini-3.1-flash-lite` | 28/29 | 23/23 | 14/14 | 14/14 | 10/10 | 7/7 | 97.7% (42/43) | 0/161 |
| `google/gemini-3.5-flash-lite` | 25/29 | 23/23 | 14/14 | 14/14 | 10/10 | 7/7 | 88.4% (38/43) | 1/161 |

What the numbers show:

- **Decision.** Three models get 41 of 43 and `google/gemini-3.1-flash-lite` gets 39. The costly errors are few and different. `google/gemini-3.5-flash-lite` never fails to call a person but passes 2 of 15 messages it could have handled itself. `google/gemini-3.1-flash-lite` makes 4 unsafe errors in 28, and both it and `google/gemini-2.5-flash` chose `answer` for "Qual o endereço do escritório de vocês?", which the reference information does not cover. No model misses an urgent case.
- **Money is not the problem.** Every model reads every budget right (`R$ 3.500,00`, `1,2 milhão`, `300k`, `uns 2 milhões`), and gets regions, bedrooms and payment right too.
- **The weak field is `goal`.** Models leave it empty on questions about renting or buying (`google/gemini-2.5-flash`: 24 of 29 right), and fill it in when the message has no goal: a tenant's complaint, a gas leak, a tenant locked out (the prompt says that someone who already rents has no goal). `google/gemini-2.5-flash-lite` gets every stated goal right but invents 8 of the 161 fields that messages do not state.
- No model is best at everything: choose by the error you can least afford.

**One label was changed after the first run.** R06 ("Como faço pra marcar uma visita?") was first labelled `answer`. All four models disagreed with it, so it was re-read against the reference information: the assistant has no agenda and the information only says that a broker schedules visits, so `handoff` is the better label. It is the only case that three or more models got wrong, and the only label changed. The tables use the new label; with the old one, `google/gemini-2.5-flash-lite` and `google/gemini-3.5-flash-lite` would show 93.0% instead of 95.3%.

Limits of this pack: 43 invented messages, one message per case (no conversation memory, no listings), written with AI assistance and not yet reviewed by other native speakers. The labels are product decisions: change `business.md`, the prompt and the labels together if your agency draws the lines elsewhere.

`predict --exec COMMAND` asks the model through a command instead of HTTP: it runs once per case (no shell), reads `{"system","user"}` as JSON on stdin and prints the reply. [`examples/openclaw-model.mjs`](examples/openclaw-model.mjs) is an example for a model reached through the OpenClaw CLI, where the API key never leaves OpenClaw.

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
