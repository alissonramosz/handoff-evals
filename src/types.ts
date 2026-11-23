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
  /** The lead card the message should give. Only the real-estate dataset has it. */
  lead?: LeadFields;
}

/** One line of a predictions file. Extra fields are ignored. */
export interface Prediction {
  id: string;
  action: string;
  /** The `lead` object of the reply, scored only on the real-estate dataset. */
  lead?: unknown;
}

export const DATASETS = ['retreat', 'realestate'] as const;
export type DatasetName = (typeof DATASETS)[number];

/** The values the real-estate lead card can take (written in Portuguese, as the people write). */
export const GOALS = ['comprar', 'alugar', 'investir', 'vender', 'anunciar'] as const;
export const PROPERTY_TYPES = ['apartamento', 'casa', 'terreno', 'comercial', 'cobertura', 'kitnet'] as const;
export const PAYMENTS = ['financiamento', 'a vista', 'fgts', 'fiador', 'seguro-fianca', 'caucao'] as const;

/** What a message says about the person: only what it states, never what could be guessed. */
export interface LeadFields {
  goal: string | null;
  propertyType: string | null;
  regions: string[];
  /** The most the person says they can pay, in whole reais. Rent is per month. */
  budget: number | null;
  bedrooms: number | null;
  payment: string | null;
}

/** A real-estate scenario: one message in Portuguese, the right action and the lead card it gives. */
export interface LeadScenario {
  id: string;
  expected: Action;
  category: string;
  /** Why this action is the right one, in terms of dataset/realestate/business.md. */
  note: string;
  message: string;
  /** Only the fields the message states; the others are empty. */
  lead: Partial<LeadFields>;
}
