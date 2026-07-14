import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings, estimateCost, representativeModel, DEFAULT_SETTINGS } from './promptgen';

test('parseSettings falls back to defaults for missing or invalid input', () => {
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('nonsense'), DEFAULT_SETTINGS);

  // Unknown enum values and wrong types are rejected, defaults kept.
  const s = parseSettings({ target: 'wat', grounding: 42, fewShot: 'yes', lang: 'en' });
  assert.equal(s.target, DEFAULT_SETTINGS.target);
  assert.equal(s.grounding, DEFAULT_SETTINGS.grounding);
  assert.equal(s.fewShot, DEFAULT_SETTINGS.fewShot);
  assert.equal(s.lang, 'en'); // valid override is kept
});

test('parseSettings keeps every valid override', () => {
  const s = parseSettings({
    target: 'coding-agent',
    engine: 'gemini',
    grounding: 'deep',
    detail: 'verbose',
    fewShot: true,
    reasoning: true,
    selfCritique: 'annotate',
    choiceValidation: true,
    lang: 'ru',
  });
  assert.deepEqual(s, {
    target: 'coding-agent',
    engine: 'gemini',
    grounding: 'deep',
    detail: 'verbose',
    fewShot: true,
    reasoning: true,
    selfCritique: 'annotate',
    choiceValidation: true,
    lang: 'ru',
  });
});

test('representativeModel maps engine to a priced model', () => {
  assert.equal(representativeModel('gemini'), 'gemini-3.1-flash-lite');
  assert.equal(representativeModel('opencode'), 'deepseek');
  // 'any' and 'claude' resolve to the Claude model this route runs.
  assert.ok(['opus', 'sonnet', 'haiku', 'fable'].includes(representativeModel('any')));
});

test('estimateCost is deterministic: ~4 chars per token, priced per engine', () => {
  const prompt = 'x'.repeat(400);
  const c = estimateCost(prompt, 'opencode');
  assert.equal(c.chars, 400);
  assert.equal(c.tokensApprox, 100); // ceil(400 / 4)
  assert.equal(c.model, 'deepseek');
  // deepseek input is $0.14 / 1M tok → 100 tok = $0.000014
  assert.ok(Math.abs(c.estimateInUsd - 0.000014) < 1e-9);
});

test('estimateCost is free for the free-tier Gemini engine', () => {
  const c = estimateCost('hello', 'gemini');
  assert.equal(c.model, 'gemini-3.1-flash-lite');
  assert.equal(c.estimateInUsd, 0);
});
