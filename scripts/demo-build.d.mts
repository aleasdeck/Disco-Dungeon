// The types of scripts/demo-build.mjs, for vite.config.ts.

import type { Plugin } from 'vite';

/** What the demo keeps and cuts, read from the game's tables. */
export interface DemoContent {
  cut: Set<string>;
  domain: Set<string>;
  names: string[];
  biomes: { all: Set<string>; cut: Set<string> };
  art: { figures: Set<string>; env: Set<string>; envPrefix: string[]; ui: Set<string>; events: Set<string>; music: Set<string> };
}
export function demoContent(root: string): Promise<DemoContent>;
export function demoManifest(m: Record<string, Record<string, unknown>>, c: DemoContent): Record<string, Record<string, unknown>>;
export function demoPublic(root: string, c: DemoContent): Map<string, Buffer>;
export function cutSource(text: string, file: string, c: DemoContent, log?: (key: string, at: string) => void): string;
export function demoHtml(html: string): string;
export function demoBuild(root: string, c: DemoContent): Plugin;
