import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { execInContainer } from './dockerService';
import { getAll, metaFor, update } from './metadataService';

const CONTAINER = process.env.CLAUDE_CONTAINER || 'ai-claude';
export const ROOT = process.env.CLAUDE_AUTH_DIR || '/home/claude/.claude';
export const LAUNCHER = `${ROOT}/platform-claude.sh`;
export const TOKEN_ID = /^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** Where the account of the global chat is stored, and the account a project
 *  follows until it picks one of its own. */
export const GLOBAL_KEY = '@global/claude';
/** tmux session of the throwaway window where a new account signs in. */
export const LOGIN_SESSION_PREFIX = 'claude-login-';
export function loginSessionName(id: string): string { return `${LOGIN_SESSION_PREFIX}${id}`; }

export interface ClaudeToken {
  id: string;
  name: string;
  /** Email of the signed-in account, once Claude has recorded one. */
  account: string | null;
  /** False while a profile is still waiting for its first login. */
  hasLogin: boolean;
}

export function parseToken(value: unknown): { token?: string; credentials?: object } {
  if (typeof value !== 'string' || value.length > 32000) throw new Error('Invalid token');
  const text = value.trim();
  if (text.startsWith('{')) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Invalid credentials JSON'); }
    const oauth = data?.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !/^sk-ant-oat[A-Za-z0-9_-]+$/.test(oauth.accessToken)) {
      throw new Error('Expected .credentials.json with claudeAiOauth.accessToken');
    }
    return { credentials: data };
  }
  if (!/^sk-ant-oat[A-Za-z0-9_-]+$/.test(text)) throw new Error('Expected Claude OAuth token (sk-ant-oat…) or .credentials.json');
  return { token: text };
}

// The launcher keeps histories shared while credentials stay in separate profiles.
// Secrets are read from disk by the child, never placed in docker/tmux arguments.
const launcher = `#!/bin/bash
set -e
root=${ROOT}
id="$1"
shift
if [ "$id" != default ]; then
  unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
  export CLAUDE_CONFIG_DIR="$root/platform-tokens/$id"
  if [ -f "$CLAUDE_CONFIG_DIR/token" ]; then
    CLAUDE_CODE_OAUTH_TOKEN=$(cat "$CLAUDE_CONFIG_DIR/token")
    export CLAUDE_CODE_OAUTH_TOKEN
  fi
else
  export CLAUDE_CONFIG_DIR="$root"
fi
# A profile's durable login survives /logout. Restore it only on a new launch,
# so an interactive logout/login flow is free to complete in the running CLI.
if [ "$id" != default ]; then
  node - "$root" "$id" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const [root, id] = process.argv.slice(2);
const dir = root + '/platform-tokens/' + id;
const backup = root + '/platform-login-snapshots/' + id + '.json';
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function write(file, value) {
  const temp = file + '.' + crypto.randomUUID();
  fs.writeFileSync(temp, JSON.stringify(value), {mode:0o600});
  fs.renameSync(temp, file);
}
const credentials = read(dir + '/.credentials.json');
const config = read(dir + '/.claude.json') || {};
const saved = read(backup);
if (!credentials?.claudeAiOauth && saved?.credentials?.claudeAiOauth) {
  write(dir + '/.credentials.json', saved.credentials);
  write(dir + '/.claude.json', {...saved.config,...config,
    oauthAccount:saved.config?.oauthAccount,hasCompletedOnboarding:true});
} else if (credentials?.claudeAiOauth && !saved) {
  fs.mkdirSync(root + '/platform-login-snapshots', {recursive:true,mode:0o700});
  const meta = read(dir + '/name.json');
  write(backup, {credentials,config,accountId:config.oauthAccount?.accountUuid || meta?.accountId || null,name:meta?.name});
}
NODE
fi
exec claude "$@"
`;

const storageScript = `
const fs = require('fs');
const crypto = require('crypto');
const root = '${ROOT}';
const dir = root + '/platform-tokens';
const snapshots = root + '/platform-login-snapshots';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.mkdirSync(snapshots, { recursive: true, mode: 0o700 });
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeAtomic(file, data, mode = 0o600) {
  const temp = file + '.' + crypto.randomUUID();
  fs.writeFileSync(temp, data, { mode });
  fs.renameSync(temp, file);
}
function writeJson(file, value) { writeAtomic(file, JSON.stringify(value)); }
function profileIds() { return fs.readdirSync(dir).filter(id => idPattern.test(id)); }
function accountOf(source) {
  const config = readJson(source + '/.claude.json');
  const email = config && config.oauthAccount && config.oauthAccount.emailAddress;
  return typeof email === 'string' && email.trim() ? email.trim().slice(0,120) : null;
}
function createProfile(p) {
  const dest = dir + '/' + p.id;
  if (fs.existsSync(dest)) return;
  const staging = dir + '/.pending-' + crypto.randomUUID();
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    // Neither field is set for a profile created to be logged into: the CLI
    // finds no credentials there and opens its own login flow.
    if (p.token) writeAtomic(staging + '/token', p.token);
    else if (p.credentials) writeJson(staging + '/.credentials.json', p.credentials);
    writeJson(staging + '/.claude.json', {...p.config,hasCompletedOnboarding:true});
    for (const name of ['settings.json', 'settings.local.json']) {
      if (fs.existsSync(root + '/' + name)) fs.copyFileSync(root + '/' + name, staging + '/' + name);
    }
    for (const name of ['projects', 'file-history', 'todos', 'plugins', 'skills']) {
      fs.mkdirSync(root + '/' + name, { recursive:true });
      fs.symlinkSync(root + '/' + name, staging + '/' + name);
    }
    writeJson(staging + '/name.json', {id:p.id,name:p.name,accountId:p.accountId || null,autoSaved:p.autoSaved === true});
    fs.renameSync(staging, dest);
  } catch (err) { fs.rmSync(staging, {recursive:true,force:true}); throw err; }
}
writeAtomic('${LAUNCHER}', input.launcher, 0o700);
for (const p of input.profiles) createProfile(p);
if (input.rename) {
  const meta = readJson(dir + '/' + input.rename.id + '/name.json');
  if (!idPattern.test(input.rename.id) || !meta) throw new Error('Unknown Claude account');
  // A name the user typed is theirs: stop letting a later login overwrite it.
  writeJson(dir + '/' + input.rename.id + '/name.json', {...meta,name:input.rename.name,autoSaved:false});
}
if (input.remove) {
  if (!idPattern.test(input.remove) || !fs.existsSync(dir + '/' + input.remove)) throw new Error('Unknown Claude account');
  // Shared history lives behind symlinks inside the profile; a recursive remove
  // deletes those links, never the directories they point at.
  fs.rmSync(dir + '/' + input.remove, {recursive:true,force:true});
  fs.rmSync(snapshots + '/' + input.remove + '.json', {force:true});
  fs.rmSync(snapshots + '/' + input.remove + '.pending.json', {force:true});
}
function loginAt(source, meta) {
  const credentials = readJson(source + '/.credentials.json');
  const oauth = credentials && credentials.claudeAiOauth;
  if (!oauth || typeof oauth.accessToken !== 'string' || !/^sk-ant-oat[A-Za-z0-9_-]+$/.test(oauth.accessToken)) return null;
  const config = readJson(source + '/.claude.json');
  if (fs.existsSync(source + '/.claude.json') && !config) return null;
  const account = config && config.oauthAccount;
  return {
    credentials,
    config: config || {hasCompletedOnboarding:true},
    accountId: account && typeof account.accountUuid === 'string' ? account.accountUuid : meta && meta.accountId || null,
    name: account && typeof account.emailAddress === 'string' && account.emailAddress.trim()
      ? account.emailAddress.trim().slice(0,80) : meta && meta.name,
  };
}
function sameTokens(a, b) {
  const x = a && a.claudeAiOauth, y = b && b.claudeAiOauth;
  return !!(x && y && (x.accessToken === y.accessToken ||
    (typeof x.refreshToken === 'string' && x.refreshToken && x.refreshToken === y.refreshToken)));
}
function sameAccount(a, b) {
  return sameTokens(a.credentials, b.credentials) || !!(a.accountId && b.accountId && a.accountId === b.accountId);
}
function label(login) {
  if (login.name) return login.name;
  const plan = login.credentials.claudeAiOauth.subscriptionType;
  return ('Claude ' + (typeof plan === 'string' ? plan : 'Account') + ' ' + (profileIds().length + 1)).slice(0,80);
}
function saveLogin(login, exclude) {
  for (const id of profileIds()) {
    if (id === exclude) continue;
    const dest = dir + '/' + id;
    const meta = readJson(dest + '/name.json');
    if (!meta) continue;
    const credentials = readJson(dest + '/.credentials.json');
    let raw;
    try { raw = fs.readFileSync(dest + '/token','utf8').trim(); } catch {}
    if (!sameTokens(credentials, login.credentials) && raw !== login.credentials.claudeAiOauth.accessToken &&
        !(login.accountId && meta.accountId === login.accountId)) continue;
    if (JSON.stringify(credentials) !== JSON.stringify(login.credentials)) writeJson(dest + '/.credentials.json', login.credentials);
    if (raw) fs.rmSync(dest + '/token', {force:true});
    const existingConfig = readJson(dest + '/.claude.json') || {};
    // Fill the profile from its login, preserving preferences and project trust
    // decisions already made in this profile. Account metadata follows the login.
    const config = {...login.config,...existingConfig,hasCompletedOnboarding:true};
    if (login.config && login.config.oauthAccount) config.oauthAccount = login.config.oauthAccount;
    if (JSON.stringify(existingConfig) !== JSON.stringify(config)) writeJson(dest + '/.claude.json', config);
    const name = meta.autoSaved && login.name ? login.name : meta.name;
    if (name !== meta.name || (login.accountId && meta.accountId !== login.accountId)) {
      writeJson(dest + '/name.json', {...meta,name,accountId:login.accountId || meta.accountId});
    }
    return id;
  }
  const id = crypto.randomUUID();
  createProfile({id,name:label(login),credentials:login.credentials,config:login.config,accountId:login.accountId,autoSaved:true});
  return id;
}
// Keep the last complete credentials for each source so re-authorizing a saved
// profile can add its old account back to the list before accepting the new one.
const sources = [{id:'default',path:root}, ...profileIds().map(id => ({id,path:dir + '/' + id}))];
if (input.captureSource && !sources.some(source => source.id === input.captureSource && loginAt(source.path, null))) {
  throw new Error('No current Claude login to save');
}
for (const source of sources) {
  const meta = source.id === 'default' ? null : readJson(source.path + '/name.json');
  const current = loginAt(source.path, meta);
  if (!current) continue; // Logout or a partially written JSON must never erase saved accounts.
  const snapshotFile = snapshots + '/' + source.id + '.json';
  const previous = readJson(snapshotFile);
  const pendingFile = snapshots + '/' + source.id + '.pending.json';
  const changed = !previous || previous.accountId !== current.accountId ||
    JSON.stringify(previous.credentials) !== JSON.stringify(current.credentials) ||
    JSON.stringify(previous.config && previous.config.oauthAccount) !== JSON.stringify(current.config.oauthAccount);
  // CLI login writes credentials and account metadata separately. Wait for a
  // stable pair before assigning the account or replacing its saved credentials.
  // Existing imported profiles get an immediate baseline to protect their old login.
  if (input.captureSource !== source.id && changed && (source.id === 'default' || previous)) {
    const signature = crypto.createHash('sha256').update(JSON.stringify({credentials:current.credentials,accountId:current.accountId,account:current.config.oauthAccount})).digest('hex');
    const pending = readJson(pendingFile);
    if (!pending || pending.signature !== signature) {
      writeJson(pendingFile, {signature,since:Date.now()});
      continue;
    }
    if (Date.now() - pending.since < 1000) continue;
  }
  fs.rmSync(pendingFile, {force:true});
  if (source.id === 'default') {
    // An unchanged default login may be older than a saved profile that has
    // refreshed itself. Capture only new credentials, never replay old ones.
    current.targetId = changed ? saveLogin(current) : previous.targetId;
  } else {
    const switched = previous && !sameAccount(previous, current);
    if (switched) {
      saveLogin(previous, source.id);
      current.name = loginAt(source.path, null).name || undefined;
      writeJson(source.path + '/name.json', {id:source.id,name:label(current),accountId:current.accountId,autoSaved:true});
    } else if (meta) {
      // A name the user chose stays; a profile the platform named follows its
      // account, so one opened for a fresh login takes that account's address.
      const name = meta.autoSaved && current.name ? current.name : meta.name;
      const accountId = current.accountId || meta.accountId;
      if (name !== meta.name || accountId !== meta.accountId) writeJson(source.path + '/name.json', {...meta,name,accountId});
    }
    // A successful interactive login takes precedence over an imported raw token.
    fs.rmSync(source.path + '/token', {force:true});
  }
  if (JSON.stringify(previous) !== JSON.stringify(current)) writeJson(snapshotFile, current);
}
const tokens = [{id:'default',name:'Current login',account:accountOf(root),hasLogin:!!loginAt(root,null)}];
for (const id of profileIds()) {
  const source = dir + '/' + id;
  const meta = readJson(source + '/name.json');
  if (!meta || typeof meta.name !== 'string') continue;
  tokens.push({id,name:meta.name,account:accountOf(source),
    hasLogin:!!loginAt(source,meta) || fs.existsSync(source + '/token') || fs.existsSync(snapshots + '/' + id + '.json')});
}
process.stdout.write(JSON.stringify(tokens));
`;

interface StorageOp {
  /** Profile to create: a saved token, or an empty one waiting for its login. */
  profile?: object;
  captureSource?: string;
  remove?: string;
  rename?: { id: string; name: string };
}

let storageWrites: Promise<unknown> = Promise.resolve();
function storage(op: StorageOp = {}): Promise<ClaudeToken[]> {
  const run = storageWrites.then(() => runStorage(op));
  storageWrites = run.catch(() => {});
  return run;
}
async function runStorage({ profile, captureSource, remove, rename }: StorageOp): Promise<ClaudeToken[]> {
  const importsDir = process.env.CLAUDE_TOKEN_IMPORT_DIR || '/run/claude-token-imports';
  let files: string[] = [];
  try { files = await fs.readdir(importsDir); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  const profiles: object[] = [];
  for (const file of files.filter(name => name.endsWith('.json'))) {
    const data = JSON.parse(await fs.readFile(path.join(importsDir, file), 'utf8'));
    if (typeof data.id !== 'string' || data.id === 'default' || !TOKEN_ID.test(data.id) ||
        typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80) {
      throw new Error('Invalid token import');
    }
    profiles.push({ id: data.id, name: data.name.trim(), ...parseToken(JSON.stringify(data.credentials)) });
  }
  if (profile) profiles.push(profile);
  const encoded = Buffer.from(storageScript).toString('base64');
  return JSON.parse(await execInContainer(CONTAINER,
    `node -e "eval(Buffer.from('${encoded}','base64').toString())"`,
    JSON.stringify({ launcher, profiles, captureSource, remove, rename })));
}

export async function listTokens(): Promise<ClaudeToken[]> { return storage(); }

let launcherReady: Promise<unknown> | undefined;
/** Starting a session or a one-shot query only needs the launcher to exist on
 *  disk. Writing it is part of a storage run, so pay that container round-trip
 *  once per process instead of once per request; the autosave poll keeps the
 *  profiles themselves current. */
export function ensureLauncher(): Promise<unknown> {
  launcherReady ??= storage().catch((err) => { launcherReady = undefined; throw err; });
  return launcherReady;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw new Error('Account name is required (max 80 characters)');
  }
  return value.trim();
}

export async function saveCurrentLogin(project?: string): Promise<ClaudeToken[]> {
  return storage({ captureSource: await selectedToken(project) });
}
export async function addToken(name: unknown, value: unknown): Promise<ClaudeToken[]> {
  return storage({ profile: { id: randomUUID(), name: cleanName(name), ...parseToken(value) } });
}
/** Creates the empty profile a fresh `claude` is launched into: with no
 *  credentials there the CLI opens its own login flow, and the poll saves
 *  whichever account it ends up signed into. */
export async function startLogin(name: unknown): Promise<{ id: string; tokens: ClaudeToken[] }> {
  const id = randomUUID();
  return { id, tokens: await storage({ profile: { id, name: cleanName(name), autoSaved: true } }) };
}
export async function renameToken(id: string, name: unknown): Promise<ClaudeToken[]> {
  return storage({ rename: { id, name: cleanName(name) } });
}
export async function removeToken(id: string): Promise<ClaudeToken[]> { return storage({ remove: id }); }

/** A project without a choice of its own follows the global account, so changing
 *  the account once applies everywhere it has not been overridden. */
export async function selectedToken(project?: string): Promise<string> {
  const store = await getAll();
  const chain = [project ? metaFor(store, project).claudeTokenId : undefined, metaFor(store, GLOBAL_KEY).claudeTokenId];
  return chain.find((id): id is string => typeof id === 'string' && TOKEN_ID.test(id)) ?? 'default';
}
export async function selectToken(project: string | undefined, id: string): Promise<void> {
  await update(project ?? GLOBAL_KEY, { claudeTokenId: id });
}
/** Drops a project's own choice so it follows the global account again. */
export async function clearToken(project: string): Promise<void> {
  await update(project, { claudeTokenId: undefined });
}
