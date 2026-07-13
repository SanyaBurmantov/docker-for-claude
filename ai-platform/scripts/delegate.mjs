#!/usr/bin/env node
// Делегирование механической работы дешёвым моделям — из сессии Claude Code или руками.
//
//   node scripts/delegate.mjs <project> deepseek "<промпт|->"
//   node scripts/delegate.mjs <project> opencode:<provider/model> "<промпт|->"
//   node scripts/delegate.mjs <project> gemini "<промпт|->" [model]
//
// deepseek / opencode:* — tool-capable: правит файлы и гоняет Bash внутри контейнера
// ai-claude, в /workspace/<project>. gemini — чистый текст-в/текст-из через бэкенд
// платформы (/api/gemini/chat), файлов не видит.
//
// Промпт «-» читается из stdin — удобно передавать большое ТЗ файлом.
// Запускать на хосте. env: CLAUDE_CONTAINER (деф. ai-claude), CONTAINER_USER (деф. claude),
// AI_PLATFORM_URL (деф. http://localhost:9900), DELEGATE_TIMEOUT_S (деф. 480).

import { spawn } from 'node:child_process';

const CONTAINER = process.env.CLAUDE_CONTAINER || 'ai-claude';
const BASE_URL = process.env.AI_PLATFORM_URL || 'http://localhost:9900';
const TIMEOUT_MS = Number(process.env.DELEGATE_TIMEOUT_S || 480) * 1000;

function usage() {
  console.error(
    [
      'Использование:',
      '  node scripts/delegate.mjs <project> deepseek "<промпт|->"',
      '  node scripts/delegate.mjs <project> opencode:<provider/model> "<промпт|->"',
      '  node scripts/delegate.mjs <project> gemini "<промпт|->" [model]',
    ].join('\n')
  );
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

/** Тот же вызов, что runOpencode в backend/src/services/engines.ts, но с обычным
 *  текстовым выводом вместо --format json: потребитель здесь — человек или Claude Code. */
function runOpencode(project, prompt, model) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-u', process.env.CONTAINER_USER || 'claude',
      '-e', 'LANG=C.UTF-8',
      '-e', 'LC_ALL=C.UTF-8',
      '-w', `/workspace/${project}`,
      CONTAINER,
      'opencode', 'run', prompt, '-m', model, '--auto',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    console.error(`\nopencode не ответил за ${TIMEOUT_MS / 1000}с`);
    process.exitCode = 1;
  }, TIMEOUT_MS);
  child.on('error', (err) => {
    clearTimeout(timer);
    console.error(`Не удалось запустить docker exec: ${err.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (process.exitCode === undefined) process.exitCode = code ?? 1;
  });
}

/** SSE-кадры бэкенда {text|error|done} — тот же формат, что читает consumeTextStream на фронте. */
async function runGemini(prompt, model) {
  const body = { messages: [{ role: 'user', text: prompt }], ...(model ? { model } : {}) };
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/gemini/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`Бэкенд платформы недоступен (${BASE_URL}): ${err.message}`);
    process.exit(1);
  }
  if (!res.ok || !res.body) {
    console.error(`HTTP ${res.status}: ${(await res.text().catch(() => res.statusText)).slice(0, 500)}`);
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let frame;
      try {
        frame = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (frame.text) process.stdout.write(frame.text);
      if (frame.error) {
        console.error(`\ngemini: ${frame.error}`);
        process.exit(1);
      }
    }
  }
  process.stdout.write('\n');
}

const [project, engine, promptArg, geminiModel] = process.argv.slice(2);
if (!project || !engine || !promptArg) usage();
if (!/^[\w.-]+$/.test(project)) {
  console.error(`Недопустимое имя проекта: ${project}`);
  process.exit(2);
}

const prompt = promptArg === '-' ? await readStdin() : promptArg;
if (!prompt.trim()) {
  console.error('Пустой промпт');
  process.exit(2);
}

if (engine === 'gemini') await runGemini(prompt, geminiModel);
else if (engine === 'deepseek') runOpencode(project, prompt, 'deepseek/deepseek-chat');
else if (engine.startsWith('opencode:') && engine.length > 'opencode:'.length)
  runOpencode(project, prompt, engine.slice('opencode:'.length));
else usage();
