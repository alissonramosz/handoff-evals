export const ACTIONS = ['answer', 'clarify', 'handoff', 'urgent'] as const;
export type Action = (typeof ACTIONS)[number];

export const LANGUAGES = ['en', 'pt', 'es', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

/** What the system decided. `invalid` means its reply had no usable action. */
export type Predicted = Action | 'invalid';

/** One situation, written in every language. */
export interface Scenario {
  id: string;
  expected: Action;
  category: string;
  /** Why this action is the right one, in terms of dataset/business.md. */
  note: string;
  messages: Record<Language, string>;
}

/** One message to evaluate: a scenario written in one language. */
export interface Case {
  /** Scenario id and language, for example "S01-en". */
  id: string;
  scenario: string;
  language: Language;
  message: string;
  expected: Action;
  category: string;
}

/** One line of a predictions file. Extra fields are ignored. */
export interface Prediction {
  id: string;
  action: string;
}
