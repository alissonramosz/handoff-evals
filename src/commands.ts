import { readFileSync, writeFileSync } from 'node:fs';
import { BASELINES, formatBaselineTable } from './baselines.js';
import { casesToJsonl, loadCases, readText } from './dataset.js';
import { formatLeadReport, scoreLeads } from './lead.js';
import { buildSystemPrompt, execCompleter, parseReply, predictAll } from './predict.js';
import { DATASET_FILES, formatRealEstateBaselines, loadRealEstateCases } from './realestate.js';
import { formatReport, score } from './score.js';
import { DATASETS, type Case, type DatasetName, type Prediction } from './types.js';

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export const HELP = `handoff-evals: test cases for AI enquiry routing and human handoff

Usage: handoff-evals <command> [options]

Commands:
  baselines                       Score the reference baselines on the dataset.
  export                          Print the test cases as JSON Lines.
  predict --base-url URL --model NAME [options]
  predict --exec COMMAND [options]
                                  Ask a model about every case and write its predictions: through
                                  an OpenAI-compatible /chat/completions endpoint, or through a
                                  command that is run once per case (no shell; it reads
                                  {"system","user"} as JSON on stdin and prints the reply).
      --api-key-env NAME          Environment variable that holds the API key (optional).
      --prompt FILE               Your own system prompt (default: the one of the dataset).
      --concurrency N             Requests in flight at the same time (default 4).
      --out FILE                  Predictions file (default predictions.jsonl).
  score FILE [--json]             Score a predictions file: one {"id","action"} object per line
                                  (and a "lead" object on the real-estate dataset).

Every command takes --dataset NAME:
  retreat                         100 multilingual cases (EN, PT, ES, RU). The default.
  realestate                      43 Brazilian Portuguese cases that also score the lead card.
`;

type Flags = Map<string, string | true>;

const BOOLEAN_FLAGS = new Set(['json', 'help']);

function parseArgs(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Option --${name} needs a value`);
    flags.set(name, value);
    i += 1;
  }
  return { positional, flags };
}

function text(flags: Flags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function datasetOf(flags: Flags): DatasetName {
  const name = text(flags, 'dataset') ?? 'retreat';
  if (!(DATASETS as readonly string[]).includes(name)) {
    throw new Error(`Unknown dataset "${name}". Use one of: ${DATASETS.join(', ')}`);
  }
  return name as DatasetName;
}

const casesOf = (dataset: DatasetName): Case[] => (dataset === 'realestate' ? loadRealEstateCases() : loadCases());

export function readPredictions(path: string): Prediction[] {
  const predictions: Prediction[] = [];
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${path} line ${index + 1}: not valid JSON`);
    }
    const { id, action, lead, raw } = (value ?? {}) as Partial<Prediction> & { raw?: unknown };
    if (typeof id !== 'string' || typeof action !== 'string') {
      throw new Error(`${path} line ${index + 1}: each line needs a string "id" and a string "action"`);
    }
    // A predictions file written by `predict` keeps the model's reply, which holds the lead card.
    const found = lead !== undefined ? lead : typeof raw === 'string' ? parseReply(raw).lead : undefined;
    predictions.push(found === undefined ? { id, action } : { id, action, lead: found });
  }
  return predictions;
}

/** Run a command. Returns the process exit code. */
export async function run(
  argv: string[],
  io: Io,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === 'help' || command === '--help') {
      io.out(HELP);
      return command === undefined ? 2 : 0;
    }
    const { positional, flags } = parseArgs(rest);

    if (command === 'baselines') {
      const dataset = datasetOf(flags);
      io.out(dataset === 'realestate' ? formatRealEstateBaselines(casesOf(dataset)) : formatBaselineTable(loadCases()));
      io.out('');
      for (const b of BASELINES) {
        if (dataset === 'retreat' || b.name !== 'keyword-en') io.out(`- \`${b.name}\`: ${b.description}`);
      }
      return 0;
    }

    if (command === 'export') {
      io.out(casesToJsonl(casesOf(datasetOf(flags))).trimEnd());
      return 0;
    }

    if (command === 'score') {
      const file = positional[0];
      if (!file) throw new Error('score needs a predictions file');
      const dataset = datasetOf(flags);
      const cases = casesOf(dataset);
      const predictions = readPredictions(file);
      const report = score(cases, predictions);
      if (dataset === 'realestate') {
        const leads = scoreLeads(cases, predictions);
        io.out(flags.has('json') ? JSON.stringify({ ...report, leads }, null, 2) : `${formatReport(report, false)}\n\n${formatLeadReport(leads)}`);
      } else {
        io.out(flags.has('json') ? JSON.stringify(report, null, 2) : formatReport(report));
      }
      return 0;
    }

    if (command === 'predict') {
      const dataset = datasetOf(flags);
      const baseUrl = text(flags, 'base-url');
      const model = text(flags, 'model');
      const execCommand = text(flags, 'exec');
      if (!execCommand && (!baseUrl || !model)) throw new Error('predict needs --base-url and --model (or --exec)');
      if (execCommand && (baseUrl || model)) throw new Error('Use --exec, or --base-url with --model, not both');
      const keyName = text(flags, 'api-key-env');
      const apiKey = keyName ? env[keyName] : undefined;
      if (keyName && !apiKey) throw new Error(`The environment variable ${keyName} is empty or not set`);
      const files = DATASET_FILES[dataset];
      const promptFile = text(flags, 'prompt');
      const template = promptFile ? readFileSync(promptFile, 'utf8') : readText(files.prompt);
      const out = text(flags, 'out') ?? 'predictions.jsonl';
      const cases = casesOf(dataset);
      const results = await predictAll({
        baseUrl,
        model,
        apiKey,
        complete: execCommand ? execCompleter(execCommand) : undefined,
        systemPrompt: buildSystemPrompt(template, readText(files.business)),
        cases,
        concurrency: Number(text(flags, 'concurrency') ?? 4),
        fetchImpl,
        onProgress: (done, total) => {
          if (done % 10 === 0 || done === total) io.err(`${done}/${total} done`);
        },
      });
      writeFileSync(out, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const datasetFlag = dataset === 'retreat' ? '' : ` --dataset ${dataset}`;
      io.out(`Wrote ${results.length} predictions to ${out}. Score them with: handoff-evals score ${out}${datasetFlag}`);
      return 0;
    }

    io.err(`Unknown command: ${command}\n\n${HELP}`);
    return 2;
  } catch (error) {
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
