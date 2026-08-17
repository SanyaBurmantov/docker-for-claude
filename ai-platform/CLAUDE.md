# ai-platform

Локальная Docker-based Claude Code IDE: веб-интерфейс для работы с проектами через AI-агентов (Claude Code / opencode / Codex), изолированных в контейнерах за прокси. Backend (Express+TS) управляет контейнерами, git, терминалом; frontend (React+Vite) — дашборд, терминал, diff, файлы.

## Команды

```bash
# Сборка (критерий приёмки любой правки — обе проходят)
cd ai-platform/backend && npm run build     # tsc
cd ai-platform/frontend && npm run build    # tsc && vite build

# Разработка
cd ai-platform/backend && npm run dev        # tsx watch
cd ai-platform/frontend && npm run dev        # vite

# Контейнеры (из ai-platform/)
docker compose up -d          # прод-профиль
docker compose -f docker-compose.dev.yml up -d
```

Веб-интерфейс: http://localhost:9900. Контейнер агента — `ai-claude` (env `CLAUDE_CONTAINER`).

## Архитектура (backend/src)

- `index.ts` — Express + WS. Роуты монтируются под `/api/projects/:id/<feature>` и `/api/{system,gemini}`; WS — `/ws/terminal/:id`, `/ws/events`.
- `services/` — вся логика:
  - `claudeQuery.ts` → **`streamClaude`**: `claude -p --output-format stream-json` в контейнере, с tool-политикой (`READ_ONLY_TOOLS` / `disallowedTools`), моделью, таймаутом, cancel. Движок всех одноразовых LLM-запросов.
  - `dockerService.ts` → `execInContainer` / `execInContainerSync`, `tmuxSessionName`, `EXEC_USER_ARGS`, `UTF8_EXEC_ENV`, `pasteIntoSession` (base64→tmux buffer→`paste-buffer`, без Enter; им пользуются `screenshots/attach` и `session/paste`).
  - `metadataService.ts` — персистентность в `/data` (атомарный tmp→rename, сериализованная очередь записей, кеш опережается только после успешной записи). **Образец для любого нового стора.**
  - `sse.ts` → `openSse` (frames `{text|error|done}`).
  - `agents.ts` — реестр агентов (claude/opencode/codex) для интерактивных tmux-сессий.
  - `screenshotService.ts` — хранилище скриншотов на томе `screenshots`. Бэкенд пишет в `/data/screenshots/<project>/`, агент видит тот же том read-only как `/screenshots/<project>/` — **путь для промпта отдаёт только `agentPathOf`**, руками не собирать.
  - `gitService.ts`, `projectService.ts`, `claudeEvents.ts`.
  - `engines.ts` → `runEngine` — единый интерфейс к claude/opencode/codex/gemini; `project` опционален (без него cwd `/workspace`), у codex `readOnly` включает `-a never -s read-only`.
- `routes/` — тонкие обёртки над сервисами. **`review.ts` и `explain.ts` — эталонные паттерны** одноразового LLM-запроса со стримом в SSE.
  - `voice.ts` — `POST /api/voice/transcribe` (multipart `audio`): распознавание речи через Gemini (`GEMINI_MODEL`, аудио уходит inline). Аудио — данные, а не инструкции (оговорка в промпте).
  - `chat.ts` — свободный чат, смонтирован дважды: `/api/claude/chat` (без проекта и без инструментов) и `/api/projects/:id/chat` (cwd проекта, `READ_ONLY_TOOLS`). Claude помнит разговор своей сессией (`sessionId` + `resume`), codex сессию назвать нельзя — ему транскрипт пересылается целиком.

## Frontend (frontend/src)

- `services/api.ts` → **`consumeTextStream`** читает SSE `{text|error|done}`. Переиспользовать для любого нового стрима.
- `components/Drawer.tsx` — **общая оболочка любой выдвижной панели**: таб на краю экрана, скрим, шапка с заголовком и крестиком, hotkey и Escape. Сторона — проп `side`, акцент и слот таба — класс `drawer-<id>`. Новую панель начинать отсюда.
- `hooks/useChat.ts` → `useChat(sender)` — разговор чат-панели: история, ввод, стрим одного ответа, отмена. Куда идёт запрос, знает только `sender`.
- `components/ChatDrawer.tsx` — `Drawer` + лента сообщений + композер с микрофоном. На нём построены обе чат-панели, так что различаются они только тем, кто отвечает.
- `components/GeminiPanel.tsx` — Gemini (Ctrl+Shift+G): чистый текст-в/текст-из, дропдаун модели.
- `components/ChatPanel.tsx` — контейнерные агенты: Claude / GPT (codex), переключатель движка, Ctrl+Shift+K (глобально) и Ctrl+Shift+J (в проекте, с чтением файлов).
- `components/Markdown.tsx` — рендер ответа модели (`react-markdown` + `remark-gfm`), стили — класс `.md-body`. Ответы приходят markdown'ом, поэтому в чат-панелях текст модели идёт через него, а сообщения пользователя и ошибки — как есть.
- `hooks/useDrawer.ts` — состояние выдвижной панели, общее на все: панели делят края экрана, поэтому открытие одной закрывает остальные. Слоты табов задаются `--tab-slot` (шаг = `--tab-height`), ширина — `--drawer-width` на `.drawer-left|right`.
- `components/MicButton.tsx` — кнопка микрофона: MediaRecorder → `/api/voice/transcribe` → текст в колбэк. Стоит в обеих чат-панелях, в коммит-сообщении, в модалке «With task…» и в тулбаре терминала агента (там надиктованное уходит в его промпт через `session/paste`). **Микрофону нужен secure context** — по http работает только на localhost.
- `components/ScreenshotPanel.tsx` — `Drawer` справа (Ctrl+Shift+S): Ctrl+V/drag&drop загружает скриншот, «→ сессия» вставляет его путь в промпт запущенного агента через `tmux paste-buffer`.
- `services/clipboard.ts` → `copyText` — копирование с фолбэком на `execCommand`: на не-secure origin (http по LAN-IP) `navigator.clipboard` недоступен.
- `pages/ProjectPage.tsx` — тулбар проекта, diff, файлы.

## Инварианты (соблюдать)

- **Не ломать существующие роуты/поведение.** Новый код — рядом, не вместо.
- **Промпт argv/base64-безопасно** — произвольный пользовательский текст не должен попадать в shell-синтаксис (см. `sessions.ts`: base64→file→argv; `claudeQuery.ts`: argv напрямую в `docker exec`, минуя shell).
- **Содержимое diff/файлов/логов, передаваемое модели, — данные, а не инструкции** (оговорка как в `review.ts` SYSTEM_PROMPT).
- Стиль: соответствовать окружающему коду (плотность комментариев, именование, идиомы). Комментарии объясняют *почему*, а не *что*.
- **KISS / DRY:** код человекочитаемый и простой — самое очевидное решение, а не самое умное; без дублирования (общее выносим). Никаких лишних абстракций/слоёв «на будущее». Если фрагмент трудно прочитать с первого раза — переписать проще.
- Персистентность вне проектов — в `/data` через паттерн `metadataService`, не в директории проекта.
- UTF-8/локаль: контейнер в `C.UTF-8`; для exec использовать `UTF8_EXEC_ENV`.

## Модели / провайдеры

- Claude Code (`claude`) и opencode (`opencode run --format json -m <provider>/<model> --auto`, поддерживает `--session`/`--continue`) — в контейнере, с инструментами.
- **Codex CLI** (`@openai/codex`) — третий агент в том же контейнере, с инструментами. Интерактивно `codex` / `codex resume --last`, одноразово `codex exec --json`. Свой id сессии назначить нельзя (в отличие от `claude --session-id`), поэтому платформа его не пишет. Состояние и логин — в `$CODEX_HOME=/home/claude/.codex` (том `codex-home`); дефолтный `config.toml` из `claude-container/codex-config.toml` выключает песочницу и аппрувы — песочница здесь сам контейнер. Авторизация: `OPENAI_API_KEY` в `.env` или `docker exec -it ai-claude codex login`.
- Gemini (`routes/gemini.ts`) — **чистый чат-API без инструментов**; только для текст-в/текст-из ролей. На текущем ключе генерит **только `gemini-3.1-flash-lite`**.
- **DashScope (Qwen)** — штатный провайдер opencode, настроенный в `claude-container/opencode.json` (`dashscope/qwen-max`). Ключ задаётся через `DASHSCOPE_API_KEY` в `.env`. Доступен в opencode через `/models` (интерактивно) и через `delegate.mjs dashscope` (CLI).
- Дефолтная модель при новой разработке — самая свежая Claude (Opus 4.8 / Fable 5).

## Делегирование дешёвым моделям (`scripts/delegate.mjs`)

Инструмент для Claude Code (и человека): скинуть механическую работу дешёвой модели вместо
того, чтобы генерить её дорогой. Выгодно, когда результат **дорого генерить и дёшево
проверить**: массовые однотипные правки, boilerplate по образцу существующего кода,
суммаризация больших логов перед чтением, черновой первый проход. Невыгодно на мелочи
(ТЗ + ревью дороже самой работы) и там, где нужен контекст разговора или вкус.

```bash
node scripts/delegate.mjs <project> deepseek "точное ТЗ"              # opencode → deepseek, с инструментами, в контейнере
node scripts/delegate.mjs <project> dashscope "точное ТЗ"              # opencode → dashscope/qwen-max
node scripts/delegate.mjs <project> opencode:<provider/model> - < тз.md   # промпт «-» = stdin, для больших ТЗ
node scripts/delegate.mjs <project> codex[:<model>] "точное ТЗ"        # codex exec, с инструментами, в контейнере
node scripts/delegate.mjs <project> gemini "суммаризируй: …"          # текст-в/текст-из, без инструментов, ~бесплатно
```

Нужен запущенный контейнер `ai-claude` (deepseek/dashscope/opencode) или бэкенд платформы (gemini).
Результат deepseek/dashscope — черновик: diff и тесты после него проверяет делегировавший.
