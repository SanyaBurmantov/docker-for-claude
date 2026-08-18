import assert from 'node:assert/strict';
import test from 'node:test';
import { paneTarget } from './paneTarget';

test('a project id resolves to its agent session, a shell id to the shell one', () => {
  assert.deepEqual(paneTarget('claude-myproj'), {
    session: 'claude-myproj',
    cwd: '/workspace/myproj',
    create: false,
  });
  assert.deepEqual(paneTarget('shell-myproj'), {
    session: 'shell-myproj',
    cwd: '/workspace/myproj',
    create: true,
  });
});

test('ids that could escape the workspace are rejected', () => {
  assert.equal(paneTarget('claude-../etc'), null);
  assert.equal(paneTarget('shell-..'), null);
  assert.equal(paneTarget('claude-a/b'), null);
});

test('every agent tab gets its own session in the project', () => {
  assert.equal(paneTarget('codex-myproj')?.session, 'codex-myproj');
  assert.equal(paneTarget('gemini-myproj')?.session, 'gemini-myproj');
  // Same project directory for all of them — they differ by session, not by cwd.
  assert.equal(paneTarget('opencode-myproj')?.cwd, '/workspace/myproj');
  assert.equal(paneTarget('nosuchagent-myproj'), null);
});
