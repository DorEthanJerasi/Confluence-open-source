import { test } from 'vitest';

// Runs under `npm run test:ai`, kept separate from the main suite so AI tests
// never need a real Anthropic key (ARCHITECTURE.md §8: AnthropicProvider vs
// StubProvider). No AI provider exists yet; this is the hook the AI work
// will add real tests under.
test.skip('AI features run against the stub provider', () => {});
