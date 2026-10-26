// The types of scripts/i18n.mjs, for the tests.

export const LANGS: string[];
export const FORMS: Record<string, number>;
export function hashOf(s: string): string;
export function pageKey(s: string): string;
export function catalog(o?: { read?: (file: string) => string; html?: string }): { lines: Map<string, string[]>; bad: string[] };
export function tablePath(lang: string): string;
export function loadTable(lang: string): Record<string, string>;
export function checkLine(lang: string, ru: string, tr: string): string[];
export function problems(): string[];
