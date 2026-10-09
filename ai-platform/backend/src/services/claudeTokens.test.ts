import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ClaudeToken } from './claudeTokens';

test('tokens persist privately, launch independently and share resumable history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-tokens-'));
  const originalPath = process.env.PATH;
  process.env.CLAUDE_AUTH_DIR = path.join(dir, 'auth');
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.CLAUDE_TOKEN_IMPORT_DIR = path.join(dir, 'imports');
  process.env.PATH = `${dir}:${originalPath}`;
  try {
    // Emulate docker exec without Docker: execute the same command and stdin locally.
    await fs.writeFile(path.join(dir, 'docker'), '#!/bin/bash\nif [ "$2" != -i ]; then exit 2; fi\nwhile [ "$1" != bash ]; do shift; done\nexec "$@"\n', { mode: 0o700 });
    await fs.writeFile(path.join(dir, 'claude'), `#!/usr/bin/env node
process.stdout.write(JSON.stringify({args:process.argv.slice(2),token:process.env.CLAUDE_CODE_OAUTH_TOKEN,config:process.env.CLAUDE_CONFIG_DIR,apiKey:process.env.ANTHROPIC_API_KEY}));
`, { mode: 0o700 });
    const service = await import('./claudeTokens');
    assert.throws(() => service.parseToken('bad-token'), /Expected/);
    assert.throws(() => service.parseToken('{invalid'), /Invalid/);
    assert.throws(() => service.parseToken('{"claudeAiOauth":{}}'), /Expected/);
    assert.throws(() => service.parseToken('sk-ant-oat01-x;echo'), /Expected/);
    await assert.rejects(service.addToken('', 'sk-ant-oat01-first'), /name/);

    const tokens = await service.addToken('Account one', 'sk-ant-oat01-first');
    const first = tokens.find(t => t.name === 'Account one')!;
    assert.ok(first);
    assert.equal(JSON.stringify(tokens).includes('sk-ant-oat'), false);
    const credential = { claudeAiOauth: {
      accessToken: 'sk-ant-oat01-second', refreshToken: 'sk-ant-ort01-refresh',
      expiresAt: 1791567863588, refreshTokenExpiresAt: 1793902857588,
      scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
      subscriptionType: 'pro', rateLimitTier: 'default_claude_ai',
    } };
    const secondTokens = await service.addToken('Account two', JSON.stringify(credential));
    const second = secondTokens.find(t => t.name === 'Account two')!;
    assert.equal((await fs.stat(`${service.ROOT}/platform-tokens/${first.id}/token`)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(`${service.ROOT}/platform-tokens/${second.id}/.credentials.json`)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${second.id}/.credentials.json`, 'utf8')), credential);
    assert.deepEqual(await service.listTokens(), secondTokens);

    await service.selectToken('project-a', first.id);
    await service.selectToken('project-b', second.id);
    assert.equal(await service.selectedToken('project-a'), first.id);
    assert.equal(await service.selectedToken('project-b'), second.id);
    assert.equal(await service.selectedToken(), 'default');
    await service.selectToken(undefined, second.id);
    assert.equal(await service.selectedToken(), second.id);
    assert.equal(await service.selectedToken('project-a'), first.id);
    // An unusable stored id is no choice at all: the project falls back to the
    // global account instead of trusting whatever the value says.
    await service.selectToken('project-a', '../escape');
    assert.equal(await service.selectedToken('project-a'), second.id);
    // A project without an account of its own follows the global one, and can be
    // handed back to it after an override.
    await service.clearToken('project-a');
    assert.equal(await service.selectedToken('project-a'), second.id);
    await service.selectToken('project-a', first.id);
    assert.equal(await service.selectedToken('project-a'), first.id);

    const resumeArgs = ['--resume', '550e8400-e29b-41d4-a716-446655440000'];
    const launch = (id: string) => JSON.parse(execFileSync(service.LAUNCHER, [id, ...resumeArgs], {
      encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: 'other-provider', CLAUDE_CODE_OAUTH_TOKEN: 'stale' }
    }));
    const raw = launch(first.id);
    assert.equal(raw.token, 'sk-ant-oat01-first');
    assert.equal(raw.apiKey, undefined);
    assert.deepEqual(raw.args, resumeArgs);
    const imported = launch(second.id);
    assert.equal(imported.token, undefined);
    assert.equal(imported.config, `${service.ROOT}/platform-tokens/${second.id}`);
    // Logout deletes the active files. A subsequent launch must restore the
    // durable login, including its account config, without another OAuth flow.
    const secondConfig = `${imported.config}/.claude.json`;
    await fs.rm(`${imported.config}/.credentials.json`);
    await fs.writeFile(secondConfig, JSON.stringify({theme:'light'}));
    await service.listTokens();
    assert.equal(launch(second.id).config, imported.config);
    assert.deepEqual(JSON.parse(await fs.readFile(`${imported.config}/.credentials.json`, 'utf8')), credential);
    assert.equal(JSON.parse(await fs.readFile(secondConfig, 'utf8')).hasCompletedOnboarding, true);
    assert.equal(JSON.parse(await fs.readFile(secondConfig, 'utf8')).theme, 'light');
    await fs.writeFile(`${service.ROOT}/projects/history.jsonl`, '{"sessionId":"saved"}\n');
    assert.equal(await fs.readFile(`${imported.config}/projects/history.jsonl`, 'utf8'), '{"sessionId":"saved"}\n');
    assert.equal(await fs.readFile(`${raw.config}/projects/history.jsonl`, 'utf8'), '{"sessionId":"saved"}\n');

    // Exercise the HTTP contract and running-session switch with a fake tmux.
    process.env.TOKEN_TEST_TMUX_STATE = path.join(dir, 'tmux.json');
    process.env.TOKEN_TEST_TMUX_LOG = path.join(dir, 'tmux-log.jsonl');
    await fs.writeFile(process.env.TOKEN_TEST_TMUX_STATE, JSON.stringify(['claude-project-a', 'claude-project-b']));
    await fs.writeFile(path.join(dir, 'tmux'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const file = process.env.TOKEN_TEST_TMUX_STATE;
let sessions = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.appendFileSync(process.env.TOKEN_TEST_TMUX_LOG, JSON.stringify(args)+'\\n');
if (args[0] === 'list-sessions') process.stdout.write(sessions.join('\\n'));
if (args[0] === 'kill-session') sessions = sessions.filter(s => s !== args[2]);
if (args[0] === 'new-session') sessions.push(args[3]);
fs.writeFileSync(file, JSON.stringify(sessions));
`, {mode: 0o700});
    // The route uses /workspace/<project>; the fake docker maps just this cwd.
    await fs.mkdir(path.join(dir, 'project-a'));
    await fs.writeFile(path.join(dir, 'docker'), `#!/usr/bin/env node
const fs = require('fs');
const {spawnSync} = require('child_process');
const args = process.argv.slice(2);
const cmd = args[args.indexOf('bash') + 2].replace('/workspace/project-a', ${JSON.stringify(path.join(dir, 'project-a'))});
const result = spawnSync('bash', ['-c', cmd], {input:fs.readFileSync(0),env:process.env});
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
`, {mode: 0o700});
    const express = (await import('express')).default;
    const router = (await import('../routes/claudeTokens')).default;
    const metadata = await import('./metadataService');
    await metadata.update('project-a', { sessionId: resumeArgs[1], claudeTokenId: first.id });
    const app = express();
    app.use(express.json()); app.use('/tokens', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as {port:number};
    const base = `http://127.0.0.1:${address.port}/tokens`;
    try {
      const list = await fetch(`${base}?project=project-a`);
      const body = await list.json();
      assert.equal(body.selected, first.id);
      assert.equal(JSON.stringify(body).includes('sk-ant-oat'), false);
      const invalid = await fetch(`${base}/selected?project=project-a`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:'../escape'})
      });
      assert.equal(invalid.status, 400);
      const traversal = await fetch(`${base}?project=../escape`);
      assert.equal(traversal.status, 400);
      const switched = await fetch(`${base}/selected?project=project-a`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:second.id})
      });
      assert.equal(switched.status, 200);
      assert.deepEqual(await switched.json(), {selected:second.id,inherited:false,restarted:['project-a']});
      assert.equal(await service.selectedToken('project-a'), second.id);
      const logs = await fs.readFile(process.env.TOKEN_TEST_TMUX_LOG!, 'utf8');
      assert.ok(logs.includes('--resume ' + resumeArgs[1]));
      assert.equal(logs.includes('sk-ant-oat'), false);
      const sessions = JSON.parse(await fs.readFile(process.env.TOKEN_TEST_TMUX_STATE!, 'utf8'));
      assert.ok(sessions.includes('claude-project-b'));
      assert.ok(sessions.includes('claude-project-a'));
      // Explicit capture must finish on the first request, even when logout
      // follows immediately, before either the poll or its settling interval.
      await service.selectToken(undefined, 'default');
      const instant = {claudeAiOauth:{...credential.claudeAiOauth,
        accessToken:'sk-ant-oat01-instant',refreshToken:'sk-ant-ort01-instant'}};
      const instantConfig = {hasCompletedOnboarding:true,
        oauthAccount:{accountUuid:'instant',emailAddress:'instant@example.test'},
        projects:{'/workspace/project-a':{hasTrustDialogAccepted:true}}};
      await fs.writeFile(`${service.ROOT}/.credentials.json`, JSON.stringify(instant));
      await fs.writeFile(`${service.ROOT}/.claude.json`, JSON.stringify(instantConfig));
      const capture = await fetch(`${base}/capture`, {method:'POST'});
      assert.equal(capture.status, 200);
      const captured = await capture.json();
      assert.equal(JSON.stringify(captured).includes('sk-ant-'), false);
      const saved = captured.tokens.find((t: {name:string}) => t.name === 'instant@example.test');
      assert.ok(saved);
      await fs.rm(`${service.ROOT}/.credentials.json`);
      await fs.rm(`${service.ROOT}/.claude.json`);
      assert.ok((await service.listTokens()).some(t => t.id === saved.id));
      assert.deepEqual(JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${saved.id}/.credentials.json`, 'utf8')), instant);
      assert.deepEqual(JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${saved.id}/.claude.json`, 'utf8')), instantConfig);
      // The reason a capture failed is the user's to see: they are about to log out.
      const noLogin = await fetch(`${base}/capture`, {method:'POST'});
      assert.equal(noLogin.status, 400);
      assert.equal((await noLogin.json()).error, 'No current Claude login to save');

      // A name the user types is theirs; an empty one is rejected.
      const json = {'Content-Type':'application/json'};
      const renamed = await fetch(`${base}/${saved.id}`, {method:'PATCH',headers:json,body:JSON.stringify({name:'Личный'})});
      assert.equal(renamed.status, 200);
      assert.ok((await renamed.json()).tokens.some((t: ClaudeToken) => t.id === saved.id && t.name === 'Личный'));
      const unnamed = await fetch(`${base}/${saved.id}`, {method:'PATCH',headers:json,body:JSON.stringify({name:'  '})});
      assert.equal(unnamed.status, 400);

      // Signing in to another account: an empty profile with a terminal of its
      // own, which the page attaches to and which leaves nothing behind if
      // the user walks away from it.
      const { paneTarget } = await import('./paneTarget');
      const login = await fetch(`${base}/login`, {method:'POST',headers:json,body:JSON.stringify({name:'Новый аккаунт'})});
      assert.equal(login.status, 201);
      const opened = await login.json();
      assert.equal(opened.session, `claude-login-${opened.id}`);
      assert.equal(paneTarget(opened.session)?.session, opened.session);
      assert.equal(paneTarget('claude-login-../escape'), null);
      const pending = opened.tokens.find((t: ClaudeToken) => t.id === opened.id);
      assert.equal(pending.name, 'Новый аккаунт');
      assert.equal(pending.hasLogin, false);
      assert.equal(JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${opened.id}/.claude.json`, 'utf8')).hasCompletedOnboarding, true);
      assert.equal((await fs.readdir(`${service.ROOT}/platform-tokens/${opened.id}`)).includes('.credentials.json'), false);
      const abandoned = await fetch(`${base}/login/${opened.id}`, {method:'DELETE'});
      assert.equal(abandoned.status, 200);
      assert.equal((await abandoned.json()).tokens.some((t: ClaudeToken) => t.id === opened.id), false);

      // Deleting an account releases every selection pointing at it and restarts
      // the sessions that were running on it.
      await metadata.update('project-a', { claudeTokenId: saved.id });
      const deleted = await fetch(`${base}/${saved.id}`, {method:'DELETE'});
      assert.equal(deleted.status, 200);
      const afterDelete = await deleted.json();
      assert.equal(afterDelete.tokens.some((t: ClaudeToken) => t.id === saved.id), false);
      assert.deepEqual(afterDelete.restarted, ['project-a']);
      assert.equal(await service.selectedToken('project-a'), await service.selectedToken());
      assert.equal((await fetch(`${base}/${saved.id}`, {method:'DELETE'})).status, 400);
      assert.equal((await fetch(`${base}/default`, {method:'DELETE'})).status, 400);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    await fs.mkdir(process.env.CLAUDE_TOKEN_IMPORT_DIR!, { mode: 0o700 });
    const importId = '11111111-1111-4111-8111-111111111111';
    await fs.writeFile(path.join(process.env.CLAUDE_TOKEN_IMPORT_DIR!, 'account.json'), JSON.stringify({
      id: importId, name: 'Saved account', credentials: credential,
    }), {mode: 0o600});
    assert.ok((await service.listTokens()).some(t => t.id === importId && t.name === 'Saved account'));
    const importedFile = `${service.ROOT}/platform-tokens/${importId}/.credentials.json`;
    assert.deepEqual(JSON.parse(await fs.readFile(importedFile, 'utf8')), credential);
    const refreshed = {claudeAiOauth:{...credential.claudeAiOauth,accessToken:'sk-ant-oat01-refreshed'}};
    await fs.writeFile(importedFile, JSON.stringify(refreshed));
    const again = await service.listTokens();
    assert.equal(again.filter(t => t.id === importId).length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(importedFile, 'utf8')), refreshed);

    // A CLI login is saved by the background worker without opening the modal.
    const rootCredentialFile = `${service.ROOT}/.credentials.json`;
    const rootConfigFile = `${service.ROOT}/.claude.json`;
    const accountA = {claudeAiOauth:{...credential.claudeAiOauth,
      accessToken:'sk-ant-oat01-login-a',refreshToken:'sk-ant-ort01-login-a'}};
    const configA = {hasCompletedOnboarding:true,theme:'dark',
      oauthAccount:{accountUuid:'account-a',emailAddress:'a@example.test',organizationUuid:'org-a'},
      projects:{'/workspace/project-a':{hasTrustDialogAccepted:true}},
      mcpServers:{example:{type:'http',url:'https://example.test/mcp'}},
    };
    await fs.writeFile(rootConfigFile, JSON.stringify(configA));
    await fs.writeFile(rootCredentialFile, JSON.stringify(accountA));
    const { startClaudeTokenAutoSave } = await import('./claudeTokenAutoSave');
    const stopAutoSave = startClaudeTokenAutoSave();
    let autoId: string | undefined;
    try {
      for (let attempt = 0; attempt < 120 && !autoId; attempt++) {
        for (const id of await fs.readdir(`${service.ROOT}/platform-tokens`)) {
          try {
            const entry = JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${id}/name.json`, 'utf8'));
            if (entry.name === 'a@example.test') autoId = id;
          } catch {}
        }
        if (!autoId) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(autoId, 'background autosave should capture a CLI login');
    } finally { stopAutoSave(); }
    const savedA = `${service.ROOT}/platform-tokens/${autoId}/.credentials.json`;
    const savedConfigA = `${service.ROOT}/platform-tokens/${autoId}/.claude.json`;
    assert.deepEqual(JSON.parse(await fs.readFile(savedConfigA, 'utf8')), configA);
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), accountA);
    assert.equal((await fs.stat(savedA)).mode & 0o777, 0o600);
    let all = await service.listTokens();
    const count = all.length;
    assert.equal(all.filter(t => t.name === 'a@example.test').length, 1);
    assert.equal(JSON.stringify(all).includes('sk-ant-'), false);
    assert.equal((await service.listTokens()).length, count);

    async function captureSettledLogin() {
      await service.listTokens();
      await new Promise(resolve => setTimeout(resolve, 1100));
      return service.listTokens();
    }

    // Both tokens rotate during refresh; account identity prevents a duplicate.
    const rotatedA = {claudeAiOauth:{...accountA.claudeAiOauth,
      accessToken:'sk-ant-oat01-rotated-a',refreshToken:'sk-ant-ort01-rotated-a',expiresAt:1791999999999}};
    await fs.writeFile(rootCredentialFile, JSON.stringify(rotatedA));
    assert.equal((await captureSettledLogin()).length, count);
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), rotatedA);
    // Account metadata refreshes, but profile-specific preferences stay intact.
    await fs.writeFile(savedConfigA, JSON.stringify({...configA,theme:'light',projects:{local:{hasTrustDialogAccepted:true}}}));
    const updatedConfigA = {...configA,oauthAccount:{...configA.oauthAccount,displayName:'Account A'}};
    await fs.writeFile(rootConfigFile, JSON.stringify(updatedConfigA));
    await captureSettledLogin();
    const mergedConfigA = JSON.parse(await fs.readFile(savedConfigA, 'utf8'));
    assert.equal(mergedConfigA.theme,'light');
    assert.deepEqual(mergedConfigA.projects,{local:{hasTrustDialogAccepted:true}});
    assert.deepEqual(mergedConfigA.oauthAccount,updatedConfigA.oauthAccount);

    // A selected profile can refresh independently of the default login.
    // Re-reading an unchanged default must not replace its newer credentials.
    const profileFreshA = {claudeAiOauth:{...rotatedA.claudeAiOauth,
      accessToken:'sk-ant-oat01-profile-fresh-a',refreshToken:'sk-ant-ort01-profile-fresh-a',expiresAt:1792999999999}};
    await fs.writeFile(savedA, JSON.stringify(profileFreshA));
    assert.equal((await captureSettledLogin()).length, count);
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), profileFreshA);
    // Logout and incomplete writes never remove the previously saved login.
    await fs.rm(rootCredentialFile);
    assert.equal((await service.listTokens()).length, count);
    await fs.writeFile(rootCredentialFile, '{incomplete');
    assert.equal((await service.listTokens()).length, count);
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), profileFreshA);

    const accountB = {claudeAiOauth:{...credential.claudeAiOauth,
      accessToken:'sk-ant-oat01-login-b',refreshToken:'sk-ant-ort01-login-b'}};
    // CLI can write credentials before account metadata. Do not overwrite A
    // while B's credentials are temporarily paired with A's old metadata.
    await fs.writeFile(rootCredentialFile, JSON.stringify(accountB));
    await service.listTokens();
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), profileFreshA);
    await fs.writeFile(rootConfigFile, JSON.stringify({oauthAccount:{accountUuid:'account-b',emailAddress:'b@example.test'}}));
    all = await captureSettledLogin();
    assert.equal(all.length, count + 1);
    assert.ok(all.some(t => t.name === 'a@example.test'));
    assert.ok(all.some(t => t.name === 'b@example.test'));
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), profileFreshA);

    // /login in a selected profile must preserve its previous account too.
    const accountC = {claudeAiOauth:{...credential.claudeAiOauth,
      accessToken:'sk-ant-oat01-login-c',refreshToken:'sk-ant-ort01-login-c'}};
    await fs.writeFile(`${service.ROOT}/platform-tokens/${autoId}/.claude.json`,
      JSON.stringify({oauthAccount:{accountUuid:'account-c',emailAddress:'c@example.test'}}));
    await fs.writeFile(savedA, JSON.stringify(accountC));
    all = await captureSettledLogin();
    assert.equal(all.length, count + 2);
    const preservedA = all.find(t => t.name === 'a@example.test')!;
    assert.ok(preservedA);
    assert.notEqual(preservedA.id, autoId);
    assert.deepEqual(JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${preservedA.id}/.credentials.json`, 'utf8')), profileFreshA);
    const previousConfig = JSON.parse(await fs.readFile(`${service.ROOT}/platform-tokens/${preservedA.id}/.claude.json`, 'utf8'));
    assert.deepEqual(previousConfig,mergedConfigA);
    assert.equal(JSON.parse(await fs.readFile(savedConfigA,'utf8')).oauthAccount.accountUuid,'account-c');
    assert.ok(all.some(t => t.id === autoId && t.name === 'c@example.test'));
    assert.equal((await service.listTokens()).length, count + 2);

    // A selected account is protected before logout, even if no polling cycle
    // occurs between saving and deletion. Metadata is restored after restart.
    await service.selectToken('project-a', autoId!);
    await service.saveCurrentLogin('project-a');
    await fs.rm(savedA);
    await fs.writeFile(savedConfigA, JSON.stringify({theme:'dark'}));
    await service.listTokens();
    launch(autoId!);
    assert.deepEqual(JSON.parse(await fs.readFile(savedA, 'utf8')), accountC);
    assert.equal(JSON.parse(await fs.readFile(savedConfigA, 'utf8')).oauthAccount.accountUuid, 'account-c');



  } finally {
    process.env.PATH = originalPath;
    delete process.env.CLAUDE_AUTH_DIR;
    delete process.env.DATA_DIR;
    delete process.env.CLAUDE_TOKEN_IMPORT_DIR;
    delete process.env.TOKEN_TEST_TMUX_STATE;
    delete process.env.TOKEN_TEST_TMUX_LOG;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
