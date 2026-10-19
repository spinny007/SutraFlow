/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/** The AI engines an AI provider connection can use. No imports, so any module can load it first. */
export const AI_ENGINES = [
  'Claude API', 'Claude CLI', 'Gemini API', 'Gemini CLI', 'OpenAI API', 'OpenAI Codex CLI',
  'Ollama', 'LM Studio', 'Hugging Face', 'Hugging Face TGI (local)', 'OpenAI-compatible server',
] as const;
export type AiEngine = (typeof AI_ENGINES)[number];
