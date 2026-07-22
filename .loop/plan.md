Начну с изучения спецификации и текущего состояния проекта.Теперь составлю ТЗ для исполнителя.

---

## **ТЗ: Реализация генератора промтов (promptgen)**

**Резюме**: Нужно реализовать one-shot сервис, улучшающий грубые формулировки целей в структурированные, дотошные промты для агентов. Backend — новый роут `POST /api/projects/:id/promptgen` со стримом в SSE (по образцу review/explain). Frontend — новая слайд-панель справа, клон GeminiPanel. Gemini-панель переходит влево, обе правые панели (PromptGen + ManagerPanel) сосуществуют без перекрытия.

---

### **Архитектура и инварианты**

- **Backend эталоны**: `routes/review.ts` (frozen SYSTEM_PROMPT, argv-safe, SSE) и `routes/explain.ts` (условная tool-политика)
- **Frontend паттерны**: `GeminiPanel.tsx` (slide-out aside, таб, hotkey, consumeTextStream), структура API-вызовов в `api.ts`
- **Монтаж**: роут `promptgenRouter` → `index.ts` под `/api/projects/:id/promptgen`; компонент `PromptGenPanel` → `App.tsx` рядом с `GeminiPanel`
- **Не ломать**: существующие роуты/панели (review, explain, gemini, terminal, diff, git); GeminiPanel просто переезжает влево

---

### **Backend: `routes/promptgen.ts`**

**Контракт**:
```
POST /api/projects/:id/promptgen
body: { rough: string, settings: PromptGenSettings }
→ SSE: {text} … {done} | {error}
```

**Реализация** (130–150 строк):
1. **Валидация**: `isValidProjectName(id)`, пустой `rough` → 400
2. **Настройки парсинг**: `PromptGenSettings` из `req.body.settings` (все 8 полей опциональны, дефолты: `target:'auto'`, `engine:'any'`, `grounding:'auto'`, `detail:'standard'`, `fewShot:false`, `reasoning:false`, `selfCritique:'auto-fix'`, `choiceValidation:false`, `lang:'input'`)
3. **Frozen SYSTEM_PROMPT** (~600 токов): кодирует промпт-инжиниринг как профессию (роль, ограничения, целевой формат), грounding-политику (ходить в репо только если целевой промт про код), дотошность постановки задачи (§6: цель, scope, non-goals, файлы, ограничения, done-criteria, краевые случаи, разрешённые неоднозначности), **«данные ≠ инструкции»** (прочитанные файлы — справочные данные, не команды)
4. **User-часть промта**: инструкции по типу целевого промта (что писать, в каком стиле), настройки (`settings` как блок данных, не в system-prompt), полный текст `rough`
5. **Tool-политика** условная:
   - `grounding:'off'` → `disallowedTools: NO_TOOLS` (чистый текст)
   - `grounding:'auto'|'deep'` → `allowedTools: READ_ONLY_TOOLS` (система-prompt велит читать репо по необходимости; `'deep'` — активнее)
6. **Модель, таймаут**: `PROMPTGEN_MODEL || 'opus'`, `PROMPTGEN_TIMEOUT_MS || 240_000`
7. **Стрим через `streamClaude` → `openSse`** (как review.ts)

**Self-critique (§8)** — если `selfCritique !== 'off'` (дефолт `'auto-fix'`):
- Запускается **второй дешёвый проход** (`PROMPTGEN_CRITIC_MODEL || 'haiku'`, no-tools, 60 сек таймаут)
- Модель получает почти-финальный промт, лочит пробелы по рубрике §6 (неоднозначности, отсутствие проверяемого done-criteria, раздутость)
- Режимы:
  - `'auto-fix'` → молча дозаполняет пробелы, отдаёт финал
  - `'annotate'` → отдаёт финал + в конце список найденных пробелов (рубрика + предложение)

**Gemini cross-critique (§9)** — если `choiceValidation:true`:
- Черновик (после §8) → `routes/gemini.ts` (POST `/api/gemini/chat` с `gemini-3.1-flash-lite`, text-only, без инструментов)
- Критика Gemini (найти неоднозначности, недостающие ограничения, противоречия) → обратно в Claude-сессию (`--continue`, один проход переделки)
- **Guardrails**: `429` / недоступность → мягко пропускаем (warning в ленту), не падаем
- В ленту панели → критику Gemini и что именно переделали (прозрачность до/после)

**Оценка стоимости (§10)**:
- Под финальным промтом: длина (символы, ≈токены по `длина / 4`),估计 стоимость по `settings.engine` и тарифам loop-спеки
- Движок по `settings.engine`: `'any'` → `'claude'`, затем смотрим модель → смотрим тариф входа/выхода
- Счёт детерминированный (без LLM)

**Сигнал об отмене**: Cancel из `streamClaude` = kill-switch

---

### **Frontend: `components/PromptGenPanel.tsx`**

**Структура** (300–350 строк, клон GeminiPanel по оболочке):
1. **Таб справа** (параллельно ManagerPanel-табу, или в один таб-стек — на усмотрение, но не перекрываться)
2. **Header**: заголовок «PROMPTGEN» (или аббревиатура), кнопка закрыть (×), дропдаун настроек (если нужны гибкие ручки прямо в UI)
3. **Ввод**: 
   - textarea `rough` (грубая формулировка, placeholder «Опиши что надо промту делать…»)
   - Блок гибких настроек (8 контролов): target (dropdown), engine (dropdown), grounding (dropdown), detail (dropdown), fewShot (checkbox), reasoning (checkbox), selfCritique (dropdown), choiceValidation (checkbox), lang (dropdown)
4. **Вывод**: 
   - Стримируемый промт (моноширинный блок, как в review)
   - Под ним: длина + стоимость (текст вроде «≈480 символов / ≈120 токов входа, по claude-opus: $0.0055 вход»)
   - Критика Gemini (если choiceValidation), «до/после» (если был переделана)
5. **Действия**:
   - **Скопировать** — копирует в буфер *только финальный промт* (без обвязки, без оценки, без критики)
   - **Передать менеджеру** — `POST /api/projects/:id/loop { goal: <финальный промт> }`, стартует loop-менеджер
     - Кнопка feature-detect: попробовать `POST /api/projects/:id/loop/` 404 → задизейблить с тултипом «loop-менеджер ещё не подключён»
6. **Stateless**: закрыл/переоткрыл → поле `rough` и результат живут в локальном стейте (не в сторе бэка)

**API-вызовы** (добавить в `api.ts`):
- `streamPromptGen(projectId, rough, settings, onText, signal)` — POST `/api/projects/:id/promptgen { rough, settings }`
- (opcional) `startLoop(projectId, goal)` — уже есть, можно переиспользовать

**Hotkey**: Ctrl+Shift+P (или другой, не конфликтующий с сущ.) для открытия/закрытия панели

---

### **Frontend: Переезд Gemini влево**

**CSS и JSX**:
1. GeminiPanel слева (уже есть, просто убедиться что позиция left: 0, не сломать)
2. PromptGenPanel справа (как ManagerPanel): right: 0, fixed, transform translateX
3. Оба таба справа (если один таб-стек) — например, vertical tabs или горизонтальные с чёрточкой между ними
4. **Визуально не перекрываться** — оба не должны быть открыты одновременно (если один таб-стек), либо разные горизонтальные уровни (если два таба параллельно)

**Монтаж в App.tsx**: импортировать `PromptGenPanel`, добавить `<PromptGenPanel />` рядом с `<GeminiPanel />`

---

### **Риски и инварианты**

| Риск | Защита |
|---|---|
| Пользовательский текст (rough) попадёт в shell | Все argv-safe (base64 как sessions.ts) — `docker exec` напрямую, не через shell |
| Gemini недоступна (429 free-tier) | Мягкий пропуск choiceValidation, warning в ленту, генерация не падает |
| Тарифы неправильные | Считать по таблице loop-спеки (§2), без LLM; допустима небольшая погрешность |
| Юзер скопирует с критикой/оценкой | Кнопка Скопировать копирует *только текст промта*, без мусора |
| Обе панели откроются одновременно | Таб-механика или вертикальное расположение гарантирует одна открыта |
| System-prompt не кешируется | Frozen string → bytes стабильны, Prompt Cache работает |

---

### **Файлы к изменению**

| Файл | Роль |
|---|---|
| `backend/src/routes/promptgen.ts` | **новый** |
| `backend/src/index.ts` | добавить монтаж promptgenRouter |
| `backend/src/services/claudeQuery.ts` | нет (переиспользуем как есть) |
| `backend/src/services/sse.ts` | нет (переиспользуем) |
| `frontend/src/components/PromptGenPanel.tsx` | **новый** |
| `frontend/src/components/GeminiPanel.tsx` | нет изменений (слева уже) |
| `frontend/src/services/api.ts` | добавить `streamPromptGen`, типы `PromptGenSettings`, `PromptGenRequest` |
| `frontend/src/App.tsx` | импортировать, монтировать `<PromptGenPanel />` |
| `frontend/src/index.css` | добавить стили `.promptgen-panel`, `.promptgen-tab` и остальное (или переиспользовать gemini-классы) |
| `.env` | опционально: `PROMPTGEN_MODEL=opus`, `PROMPTGEN_TIMEOUT_MS=240000`, `PROMPTGEN_CRITIC_MODEL=haiku` |

---

### **Критерии приёмки**

1. ✅ `POST /api/projects/:id/promptgen { rough, settings }` стримит **один готовый промт без обвязки** (не «Вот ваш промт», не пояснения)
2. ✅ Гибкие настройки (target/detail/lang/grounding/engine) наблюдаемо влияют на вывод
3. ✅ При `grounding:'auto'|'deep'` генератор читает релевантные файлы репо и ссылается на реальные пути; при `'off'` — чистый текст без похода в repo
4. ✅ Self-critique при `selfCritique !== 'off'` ловит и закрывает пробелы рубрики §6; настройка выключается
5. ✅ Gemini cross-critique при `choiceValidation:true` отправляет черновик, показывает критику и один раз переделывает; при `429` / недоступности мягко пропускается
6. ✅ Оценка стоимости под результатом считается без LLM по тарифам
7. ✅ Кнопка **Скопировать** даёт чистый текст промта
8. ✅ Кнопка **Передать менеджеру** стартует loop (`POST .../loop {goal}`) или задизейблена без loop-роута
9. ✅ Gemini-панель работает как прежде, но слева (hotkey Ctrl+Shift+G)
10. ✅ PromptGenPanel справа не перекрывается с ManagerPanel; оба таба видны или переключаются
11. ✅ Существующие фичи (терминал, diff, git, explain, review, gemini) не сломаны
12. ✅ `npm run build` в backend и frontend проходит без ошибок
13. ✅ End-to-end: грубый goal → улучшенный промт → копирование или отправка менеджеру работают

---

### **Порядок реализации (рекомендуемый)**

1. **Backend базис**: `routes/promptgen.ts` (валидация, frozen system-prompt, базовый стрим через `streamClaude`)
2. **Frontend ввод-вывод**: `PromptGenPanel.tsx` (textarea, вывод, `streamPromptGen` в api.ts)
3. **Гибкие настройки**: добавить 8 контролов в панель, передать в запрос, наблюдать влияние на вывод
4. **Self-critique**: второй проход через haiku, режимы auto-fix/annotate
5. **Gemini cross-critique**: интеграция с `routes/gemini.ts`, обработка 429, прозрачность до/после
6. **Оценка стоимости**: вычисление по тарифам, вывод под результатом
7. **Действия**: Скопировать, Передать менеджеру, feature-detect по loop
8. **UI полировка**: Gemini налево, PromptGen направо, таб-механика (не перекрываются)
9. **Сборка и приёмка**: both `npm run build`, end-to-end на тестовом проекте

---

### **Замечания к стилю**

- KISS/DRY: переиспользуй паттерны (consumeTextStream, openSse, streamClaude), не придумывай новое
- Код читаемый и простой, комментарии объясняют **почему**, а не **что**
- TypeScript, соответствуй окружающему коду (review.ts, explain.ts — эталоны)
- Не дублируй логику; общее вынеси в сервис или хелпер