import assert from 'node:assert/strict';
import test from 'node:test';
import { codexExecArgs, extractJsonlText, opencodeRuntimeConfig } from './engines';
import { parseAiProvider, providerFallbackChain } from './providerFallback';

test('Codex read-only args use the supported sandbox option without legacy -a', () => {
  const args = codexExecArgs({
    prompt: 'hello',
    systemPrompt: 'system',
    engine: { engine: 'codex', model: '' },
    readOnly: true,
  });

  assert.deepEqual(args.slice(0, 4), ['exec', '--json', '--skip-git-repo-check', '-s']);
  assert.equal(args.includes('-a'), false);
  assert.equal(args.includes('read-only'), true);
});

test('Codex JSONL output returns only the completed agent message', () => {
  const stdout = [
    '{"type":"thread.started","thread_id":"01a0d7f1-3e57-7c71-bce2-ea6d58a5dec8"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Привет! Чем помочь?"}}',
    '{"type":"turn.completed","usage":{"input_tokens":13379,"output_tokens":10}}',
  ].join('\n');

  assert.equal(extractJsonlText(stdout), 'Привет! Чем помочь?');
});

test('fallback starts at the selected provider and ends with free OpenCode models', () => {
  assert.deepEqual(
    providerFallbackChain('claude', { claude: 'sonnet' }, ['opencode/free-a', 'opencode/free-b']),
    [
      { engine: 'claude', model: 'sonnet' },
      { engine: 'codex', model: '' },
      { engine: 'gemini', model: '' },
      { engine: 'opencode', model: 'opencode/free-a' },
      { engine: 'opencode', model: 'opencode/free-b' },
    ]
  );
  assert.deepEqual(providerFallbackChain('codex', {}, ['opencode/free']), [
    { engine: 'codex', model: '' },
    { engine: 'gemini', model: '' },
    { engine: 'opencode', model: 'opencode/free' },
  ]);
  assert.deepEqual(providerFallbackChain('opencode', {}, ['opencode/free']), [
    { engine: 'opencode', model: 'opencode/free' },
  ]);
});

test('provider parsing is strict but remains backward compatible when omitted', () => {
  assert.equal(parseAiProvider(undefined), 'claude');
  assert.equal(parseAiProvider('gemini'), 'gemini');
  assert.equal(parseAiProvider('opencode'), 'opencode');
});

test('OpenCode fallback cannot mutate a project during read-only requests', () => {
  assert.deepEqual(JSON.parse(opencodeRuntimeConfig({ readOnly: true }) || ''), {
    permission: {
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      lsp: 'allow',
    },
  });
  assert.deepEqual(JSON.parse(opencodeRuntimeConfig({ readOnly: true, disallowedTools: 'all' }) || ''), {
    permission: 'deny',
  });
});
