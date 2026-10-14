/** The AI engines an AI provider connection can use. No imports, so any module can load it first. */
export const AI_ENGINES = [
  'Claude API', 'Claude CLI', 'Gemini API', 'Gemini CLI', 'OpenAI API', 'OpenAI Codex CLI',
  'Ollama', 'LM Studio', 'Hugging Face', 'Hugging Face TGI (local)', 'OpenAI-compatible server',
] as const;
export type AiEngine = (typeof AI_ENGINES)[number];
