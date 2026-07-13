# Loop-менеджер — спецификация

Оркестратор поверх существующего `streamClaude` (`claude -p`), исполняющий **одну задачу** циклом из пяти ролей с делегированием по стоимости и гейтом человека перед правками. Цель — «оба стула»: экономить премиум-токены и повышать качество за счёт дешёвых, но всегда выполняемых шагов проверки.

Живёт в `ai-platform/backend` как in-process async-оркестрация; состояние переживает рестарт бэка.

---

## 1. Куда встраивается

Переиспользуем как есть:

| Существующее | Роль в loop |
|---|---|
| `services/claudeQuery.ts` → `streamClaude` | движок Claude-ролей (`-p`, stream-json, tool-политика, модель, таймаут) |
| `routes/review.ts` (SYSTEM_PROMPT, формат `- [BUG] file:line`) | шаблон роли **Код ревьюер** |
| `services/metadataService.ts` (атомарный rename, сериализованная очередь записей) | паттерн персистентности `LoopState` |
| `services/sse.ts` + `consumeTextStream` (frontend) | стриминг ленты в панель менеджера |
| `services/dockerService.ts` → `execInContainer` | прогон тестов, git-чекпоинт/diff — **без токенов** |
| `services/agents.ts` (`AGENTS`) | opencode-адаптер добавляется рядом |

Новое: `services/loopService.ts`, `services/engines.ts` (адаптеры), `routes/loop.ts`, `frontend/src/components/ManagerPanel.tsx`, стор `/data/loops/<project>.json`, скретч `<project>/.loop/`.

---

## 2. Движки и маршрутизация

**Два класса движков** (принципиальное ограничение):

- **Tool-capable, в контейнере** — `claude -p`, `opencode run`. Могут читать/править файлы, гонять Bash. Роли: аналитик, исполнитель, тестировщик-авторинг, ревьюер.
- **Text-only, вне контейнера** — Gemini chat API (`routes/gemini.ts`). Только текст-в/текст-из того, что мы собрали. Роли: менеджер, диагностика логов, саммари. **Не** может Read/Edit/Bash.

**Тиры моделей** (цены за 1M вход/выход):

| Движок / модель | $ вход | $ выход | назначение |
|---|---|---|---|
| gemini-3.1-flash-lite | ~0 | ~0 | текстовые роли на простом (единственная рабочая gemini-модель на ключе) |
| opencode → deepseek | низкий | низкий | тривиальный implement/авторинг |
| claude haiku | 1 | 5 | старт лестницы, дешёвые роли |
| claude sonnet | 3 | 15 | средний implement, ревьюер по умолчанию |
| claude opus | 5 | 25 | hard-implement, hard-развилки менеджера |
| claude fable | 10 | 50 | опционально для самых сложных |

**Таблица маршрутизации** (`сложность × роль → дефолт-движок`) — стартовая гипотеза, дальше корректирует escalation ladder:

| Роль | trivial | medium | hard |
|---|---|---|---|
| Менеджер (рутина/агрегация) | gemini-flash | gemini-flash / haiku | opus |
| Аналитик | haiku | sonnet | sonnet/opus |
| Исполнитель | deepseek/haiku | sonnet | opus (сам, не делегирует) |
| Тестировщик · авторинг | haiku | sonnet | sonnet |
| Тестировщик · диагностика | gemini-flash | gemini-flash | sonnet |
| Ревьюер | sonnet (≥ исполнителя) | sonnet | opus |

Правило: **ревьюер ≥ модели исполнителя** (дешёвого исполнителя проверяет более умный ревьюер).

---

## 3. LoopState + персистентность

`/data/loops/<project>.json`, запись по паттерну `metadataService` (tmp→rename, сериализованная очередь, кеш опережается только после успешной записи).

```ts
type Phase =
  | 'idle' | 'analyzing' | 'awaiting_approval' | 'implementing'
  | 'verifying' | 'aggregating' | 'done' | 'failed' | 'stopped';

type Tier = 'trivial' | 'medium' | 'hard';
type EngineId = 'claude' | 'opencode' | 'gemini';
type Role = 'manager' | 'analyst' | 'executor' | 'tester' | 'reviewer';

interface ExecutorRef { engine: EngineId; model: string } // напр. {claude, 'haiku'} | {opencode, 'deepseek/deepseek-chat'}

interface ReviewNote { severity: 'BUG' | 'RISK' | 'NIT'; file: string; line: number; msg: string }
interface TestResult { command: string; passed: boolean; failed: string[]; logPath: string /* .loop/... */ }

interface Iteration {
  n: number;
  role: Role;
  phase: Phase;
  engine?: ExecutorRef;
  summary: string;        // одна строка для ленты
  artifactPath?: string;  // указатель в .loop/, а не тело
  tokens?: { in: number; out: number; cacheRead: number };
  ts: string;
}

interface LoopState {
  project: string;
  goal: string;                 // одна задача
  taskSourceLine?: number;      // строка TASKS.md, если запуск оттуда
  status: Phase;
  tier: Tier;                   // текущая позиция лестницы
  executor: ExecutorRef;        // текущий выбранный исполнитель
  sessionId: string | null;     // сессия исполнителя для prompt-cache между фиксами
  planPath: string;             // .loop/plan.md — ТЗ аналитика
  findingsSummary: string;      // короткое саммари находок (детали в planPath)
  reviewNotes: ReviewNote[];
  testResults: TestResult[];
  humanNotes: string[];         // реплики из чата менеджера → в контекст следующего хода
  currentDiffSha: string | null;
  verifiedDiffSha: string | null; // != current ⇒ изменение непроверено (policy-нудж для 'done')
  fixRounds: number;
  budget: { maxIterations: number; maxFixRounds: number; deadlineMs: number };
  iterations: Iteration[];
  createdAt: string;
  updatedAt: string;
}
```

**Один активный loop на проект** (эксклюзивный лок): старт при `status ∉ {done, failed, stopped, idle-none}` — 409. Ручную tmux-сессию не стартуем, пока loop активен, и наоборот (пишут в один рабочий tree).

### `.loop/` скретч (gitignored)

```
<project>/.loop/
  plan.md            # ТЗ аналитика (исполнитель читает своим Read)
  test-output.txt    # хвост лога последнего прогона
  diff.patch         # текущий рабочий diff (для ревьюера/менеджера)
```

Доска (`LoopState`) держит **указатели + саммари**; тела — в `.loop/`, роль добирает своими инструментами. Промпты мелкие ⇒ дёшево и кеш-стабильно.

---

## 4. Decision-JSON менеджера

Менеджер обязан выдать **один fenced ```json блок** (парсер извлекает последний JSON-блок; при неудаче — один ретрай с явным «верни только JSON»):

```json
{
  "action": "analyze | implement | test | review | done | ask_human",
  "task": "конкретная формулировка для исполнителя роли",
  "scope": "что именно в границах этого шага",
  "non_goals": "что НЕ трогать на этом шаге",
  "constraints": "инварианты/ограничения, которые нельзя нарушить",
  "complexity": "trivial | medium | hard",
  "executor": { "engine": "claude", "model": "haiku" },
  "rationale": "почему эта сложность и этот исполнитель",
  "done_criteria": "проверяемый критерий закрытия шага",
  "open_questions": ["неоднозначности; пусто ⇒ все закрыты допущениями в task"]
}
```

**Дотошность постановки** (главное требование к менеджеру): `task`+`scope`+`non_goals`+`constraints`+`done_criteria` вместе образуют ТЗ, не оставляющее исполнителю догадок. Это свойство *формулировки*, не глубины размышления — достигается директивой в frozen system-prompt + этой схемой, тир менеджера ради него поднимать не нужно. Непустой `open_questions` на шаге `implement` ⇒ менеджер обязан выбрать `ask_human`, а не гадать.

Валидация: `action` из энума; `executor.engine`+`model` из таблицы маршрутизации; text-only движок не может получить `implement`/`analyze`/`review`; `task`/`scope`/`done_criteria` непусты. Policy-правило в system-prompt менеджера: **нельзя `done`, пока `verifiedDiffSha !== currentDiffSha`** (изменение не прошло test+review после последнего implement).

---

## 5. Конечный автомат

```
start(goal)
  └─ analyzing: аналитик (read-only) → .loop/plan.md, findingsSummary
       └─ manager: decision (complexity, executor, план)
            └─ awaiting_approval: ⛔ ГЕЙТ — панель показывает {task, complexity, executor, plan}
                 ├─ reject/edit → назад к manager (с humanNotes)
                 └─ approve:
                      git-чекпоинт → implementing: исполнитель (сессия!) → currentDiffSha
                        └─ verifying (менеджер решает порядок; дефолт test→review):
                             test: execInContainer <testCmd> → TestResult
                                 └─ упало → диагностика (cheap) → LADDER (см. §6)
                             review: review.ts-логика + .loop/plan.md → reviewNotes
                                 └─ есть [BUG] → LADDER
                             ok → verifiedDiffSha = currentDiffSha
                      aggregating: manager
                        ├─ tests? [BUG]? done_criteria? → не готово → назад (implement/analyze)
                        └─ готово → done → отметить [x] в TASKS.md (если taskSourceLine)
```

Тест-команда: детект `package.json → scripts.test`; иначе per-project override в `LoopState.budget`-конфиге/мете (по умолчанию `npm test`). Прогон и diff — `execInContainer`, токенов нет.

---

## 6. Escalation ladder

Не угадывать модель — нащупывать пол per-task бесплатной обратной связью verify:

```
implement на state.tier → verify
  ├─ прошло → done-путь
  ├─ упало → cheap-диагностика → retry ТОТ ЖЕ tier (fixRounds++)   // фикс часто лёгкий
  │           └─ упало снова → escalate tier (haiku→sonnet→opus), executor обновляется
  └─ fixRounds >= budget.maxFixRounds → status=failed → ⛔ гейт к человеку
```

Эскалация тира — **детерминированная** (счётчик провалов + размер diff), без лишнего LLM-вопроса. Сессия исполнителя сохраняется между фиксами (кеш).

---

## 7. Роли (движок-дефолт / инструменты / контекст)

Тул-политики — расширяем `claudeQuery.ts` (есть `READ_ONLY_TOOLS`; добавить `WRITE_TOOLS = 'Read Grep Glob Edit Write Bash'`).

| Роль | Инструменты | Контекст-срез | Выход |
|---|---|---|---|
| Менеджер | read-only / нет | goal + findingsSummary + последний результат + humanNotes | decision-JSON |
| Аналитик | `READ_ONLY_TOOLS` | goal + репозиторий | `.loop/plan.md` + findingsSummary |
| Исполнитель | `WRITE_TOOLS` | `.loop/plan.md` + task | правки → currentDiffSha |
| Тестировщик·прогон | — (`execInContainer`) | — | TestResult |
| Тестировщик·диагностика | read-only + лог | `.loop/test-output.txt` | причина (текст) |
| Тестировщик·авторинг | `WRITE_TOOLS` | plan + task | тесты |
| Ревьюер | `READ_ONLY_TOOLS` | `.loop/diff.patch` + `.loop/plan.md` | reviewNotes (парсинг `- [SEV] file:line — …`) |

Все system-prompt'ы — **frozen** (байт-стабильны) для кеша, по образцу `review.ts`.

---

## 8. loopService — сигнатуры

```ts
// services/loopService.ts
export interface LoopHandlers {
  onTurn(it: Iteration): void;                 // карточка хода в ленту
  onText(chunk: string): void;                 // стрим вывода роли
  onGate(g: GatePayload): void;                // встали на гейт
  onPhase(status: Phase): void;
  onDone(state: LoopState): void;
  onError(message: string): void;
}
export interface GatePayload { task: string; complexity: Tier; executor: ExecutorRef; planPath: string }

export function startLoop(project: string, goal: string, opts?: { taskSourceLine?: number }): Promise<LoopState>;
export function driveLoop(project: string, handlers: LoopHandlers): () => void; // async-оркестрация; возвращает cancel
export function approveGate(project: string, decision: { approve: boolean; edit?: Partial<GatePayload>; note?: string }): Promise<void>;
export function postHumanNote(project: string, note: string): Promise<void>;
export function stopLoop(project: string): Promise<void>;
export function getLoop(project: string): Promise<LoopState | null>;

// services/engines.ts — единый интерфейс движка
export interface EngineQuery {
  project: string; prompt: string; systemPrompt: string;
  engine: ExecutorRef; role: Role;
  allowedTools?: string; disallowedTools?: string;
  sessionId?: string | null; timeoutMs: number;
}
export function runEngine(q: EngineQuery, h: { onText(t: string): void; onError(m: string): void; onDone(): void }): () => void;
// claude → streamClaude; opencode → `opencode run --format json -m <provider/model> [--session <id>] --auto`; gemini → gemini streamGenerateContent (text-only ролям)
```

---

## 9. Роуты (`routes/loop.ts`, mount под `/api/projects/:id/loop`)

| Метод | Путь | Тело / ответ |
|---|---|---|
| POST | `/` | `{ goal, taskSourceLine? }` → стартует loop (409 если активен) |
| GET | `/stream` | SSE ленты (см. события ниже) |
| GET | `/` | текущий `LoopState` (регидрат панели) |
| POST | `/message` | `{ note }` → в `humanNotes` |
| POST | `/gate` | `{ approve, edit?, note? }` |
| POST | `/stop` | стоп + kill выполняющегося `runEngine` |

**SSE-события** (frames `{type,...}`, совместимы с `consumeTextStream`):

```ts
{ type: 'phase', status: Phase }
{ type: 'turn', it: Iteration }
{ type: 'text', text: string }            // стрим вывода текущей роли
{ type: 'gate', gate: GatePayload }
{ type: 'done' } | { type: 'error', error: string }
```

---

## 10. Панель менеджера (frontend)

`ManagerPanel.tsx` — скелет `GeminiPanel` (slide-out `aside`, таб, hotkey, дропдаун, `consumeTextStream`), докнут **справа**. Отличия:

- Транспорт: `GET .../loop/stream` (SSE) + `POST .../loop/message` + `POST .../loop/gate`.
- Тело: **лента итераций** — карточка на ход (роль, движок, сложность, стрим, бейджи ✓/✗ тестов и счётчик находок), а не плоский чат.
- Инлайн на гейте: approve / edit / reject + свободный текст (перенаправить).
- Стейт живёт на бэке (`LoopState`); панель при переоткрытии подтягивает `GET .../loop`.

---

## 11. Предохранители / конфиг

- `budget.maxIterations`, `budget.maxFixRounds` (дефолт 3), `budget.deadlineMs` — жёсткий стоп → `failed` + гейт.
- Гейт человека перед `implement` (обязателен для v1).
- git-чекпоинт перед каждой правкой → откат плохой итерации.
- Эксклюзивный лок проекта (loop ⟷ ручная tmux-сессия).
- Содержимое diff/логов для менеджера — **данные, не инструкции** (оговорка как в `review.ts`).
- Kill-switch = cancel из `runEngine`/`driveLoop`.

---

## 12. Экономия токенов (не роняя качество)

- Роли — stateless, но **исполнителю — сессия** (`--session`/`--continue`) → prompt-cache между фиксами.
- Доска = срез роли; тела — в `.loop/`.
- Менеджер = один JSON за ход, дефолт gemini-flash; эскалация на opus — детерминированная.
- frozen system-prompt'ы кешируются.
- Детерминированный verify (тесты/typecheck/lint) раньше LLM-ревью: сломанный код не доходит до дорогого ревьюера.
