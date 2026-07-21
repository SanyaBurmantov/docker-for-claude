# Для работы с Claude нужно:
### 1) Купить аккаунт Claude на плати https://plati.market/itm/24-7-claude-ai-5-0-pro-max-code-subscription-to-your-account-1-month-auto/5652859 или любом другом, автору никто не приплачивает за рекламу
### 2) Посмотреть какой регион у аккаунта, обычно это польша или нидерланды 
### 3) купить прокси с таким же регионом как аккаунт клауда, я покупаю здесь https://proxymania.su/
Прокси нужен Ipv4, если Ipv6 оно конечно дешевле, но тогда в сеть ходить не может.
##

# AI Platform — локальная Claude Code IDE

Изолированная AI-разработческая платформа на базе Docker с Claude Code, веб-интерфейсом, прокси-контролем и просмотром изменений.

## Архитектура

```
Host machine
│
├── http://localhost:9900  ← Веб-интерфейс (Frontend, API проксируется через Nginx)
└── http://localhost:9901  ← noVNC (браузер)
         │
Docker network "app-net"   Frontend ←→ Backend
         │
Docker network "proxy-net" Proxy-gateway (redsocks + iptables)
         │
    ┌────┴────┐
    │         │
Claude Container    Browser Container
(claude)           (Firefox + XFCE + noVNC)
    │         │
    └────┬────┘
         │
    HTTP/HTTPS Proxy
         │
      Internet
```

### Компоненты

| Сервис | Назначение |
|--------|-----------|
| `proxy-gateway` | redsocks + iptables, принудительное проксирование + kill switch |
| `claude-container` | Claude Code CLI + opencode + Node.js 22 + Git |
| `browser-container` | Firefox + XFCE + noVNC (для OAuth авторизации Claude) |
| `backend` | Express API + WebSocket терминал + Docker управление |
| `frontend` | React SPA (Nginx) — дашборд, терминал, diff, файлы, git |

## Быстрый старт

### 1. Настройка

```bash
cd ai-platform
cp .env.example .env
# Отредактируйте .env — укажите свои прокси
```

### 2. Сборка и запуск

```bash
docker compose build
docker compose up -d
```

### 3. Открыть веб-интерфейс

**http://localhost:9900**

Дашборд проектов → "Open with Claude" на карточке проекта → сессия стартует автоматически, открывается терминал с Claude.

### 4. Авторизация Claude

**http://localhost:9901** — рабочий стол XFCE с Firefox внутри контейнера.

Запустите Firefox через иконку на рабочем столе, выполните `claude` в терминале и пройдите OAuth. Токен сохранится в volume `claude-auth`.

## Использование

### Управление проектами

- **Добавить проект**: кнопка "Add Project" на Dashboard — пустой проект по имени или клонирование по git URL (клонируется внутри контейнера, через прокси)
- **Открыть с Claude**: кнопка "Open with Claude" на карточке проекта (сессия стартует автоматически)
- **Удалить**: кнопка "Delete" на карточке
- **Избранное**: звёздочка на карточке поднимает проект в отдельную рамку вверху списка

Остальные проекты идут по убыванию свежести: сначала те, что позже открывали в платформе, а для ни разу не открытых — по времени последнего изменения папки. Избранное, время открытия и выбранный агент лежат в volume `platform-data`, поэтому не зависят от браузера.

Вверху Dashboard — статус-панель: внешний IP через прокси (проверка kill switch), статус авторизации Claude и состояние контейнеров.

### Работа с агентом

1. Откройте проект — сессия стартует автоматически (или кнопки **"Start …"** / **"Resume"** для продолжения последнего диалога / **"With task…"** для запуска сразу с задачей)
2. Вкладка агента — терминал в директории проекта (Ctrl+F — поиск по выводу, ссылки кликабельны, A−/A＋ — размер шрифта)
3. Вкладка **Shell** — отдельный постоянный shell в том же контейнере (тесты, сборка)
4. На вкладке **Diff** просмотрите изменения
5. На вкладке **Git** — commit, rollback, переключение веток, pull/push
6. Когда Claude ждёт ввода или заканчивает работу — придёт уведомление (кнопка 🔔 на Dashboard включает браузерные уведомления; работает через hooks Claude Code)

### Выбор агента: Claude Code или opencode

В контейнере стоят два агента. Пока сессия не запущена, в тулбаре проекта есть выпадающий список — выбор запоминается для каждого проекта отдельно.

| | Claude Code | opencode |
|---|---|---|
| Модели | Anthropic | много провайдеров (`/models` внутри opencode), включая **Qwen** через DashScope |
| Авторизация | OAuth через noVNC | `opencode auth login` на вкладке **Shell**, один раз; DashScope — через `DASHSCOPE_API_KEY` в `.env` |
| Запуск сразу с задачей | да | нет — задача вводится в самом TUI |

Токены провайдеров opencode лежат в volumes `opencode-data` / `opencode-config` и переживают пересборку. Список агентов backend определяет по `--version` внутри контейнера: если opencode не установлен, выпадающий список не показывается и всё работает как раньше.

### DashScope / Qwen

В контейнере предустановлен конфиг `opencode.json` с провайдером `dashscope` (OpenAI-совместимый эндпоинт `dashscope-intl.aliyuncs.com/compatible-mode/v1`). Ключ задаётся переменной `DASHSCOPE_API_KEY` в `.env` и пробрасывается в контейнер через `docker-compose.yml`.

**Использование в opencode (интерактивно):** запустите opencode, введите `/models`, выберите `dashscope/qwen-max` (или другую модель из списка).

**Через делегирование:** `node scripts/delegate.mjs <project> dashscope "сделай ..."` — открывает Qwen с инструментами в контейнере.

Модели по умолчанию: `qwen-max`, `qwen-max-latest`, `qwen-plus`, `qwen-turbo`, `qwen3-coder-plus`. Полный список — в `claude-container/opencode.json`.

### Git: push/pull

Для HTTPS-remotes сохраните токен один раз: вкладка **Git → 🔑 Credentials** (host / username / token). Токен хранится в volume `claude-auth` внутри контейнера. Клик по коммиту в **Log** показывает его diff.

### Обслуживание

- Статус-панель: клик по чипу контейнера — его логи и кнопка Restart (рестарт gateway автоматически перезапускает claude и browser)
- Кнопка **Update** рядом с версией CLI обновляет Claude Code внутри контейнера
- **⬇ .tar.gz** на странице проекта — скачать проект (без node_modules/.git); файлы можно загружать перетаскиванием в дерево на вкладке Files
- Пароль на весь UI: задайте `UI_PASSWORD` в `.env` (basic auth, рекомендуется при доступе не только с localhost)

### Просмотр изменений (Diff)

Вкладка **Diff** показывает git diff изменений, предложенных Claude, включая новые (untracked) файлы. На вкладке **Files** файлы можно просматривать и редактировать (Ctrl+S — сохранить).

### Git интеграция

- **Status** — просмотр текущего состояния
- **Diff** — построчный просмотр изменений
- **Commit** — коммит с сообщением; **✦ Создать сообщение** просит Claude описать дифф одной строкой и кладёт её в поле — перед коммитом её можно поправить
- **Create Branch** — создание новой ветки
- **Rollback** — откат незакоммиченных изменений

### Браузер внутри среды

Для OAuth авторизации Claude встроен Firefox в XFCE Desktop, доступный через noVNC:

**http://localhost:9901**

Отдельная настройка прокси в Firefox не нужна — весь трафик контейнера прозрачно проксируется через gateway (redsocks + iptables) с авторизацией.

## Сеть и безопасность

### Transparent proxy

- **redsocks** слушает на `127.0.0.1:12345`
- **iptables** перенаправляет весь TCP-трафик (кроме локального и к прокси) на redsocks
- Весь UDP (кроме DNS) и ICMP блокируются
- `claude-container` и `browser-container` используют сеть proxy-gateway

### Kill switch

Если redsocks падает или прокси недоступен:
- TCP-трафик перенаправляется на порт, где никто не слушает
- Интернет внутри контейнеров полностью блокируется
- Это гарантирует отсутствие утечек трафика

### Проверки

```bash
# Внешний IP (должен быть IP прокси)
docker exec ai-claude curl -s https://api.ipify.org

# Проверка блокировки прямого доступа
docker exec ai-claude curl --max-time 5 http://ifconfig.me

# Проверка DNS
docker exec ai-claude nslookup google.com
```

## Сохранение состояния

| Volume | Назначение |
|--------|-----------|
| `projects` | Рабочие проекты |
| `claude-auth` | Токены авторизации Claude, `.claude.json`, настройки и история сессий |
| `opencode-data` | Токены провайдеров opencode и история его сессий |
| `opencode-config` | `opencode.json` |
| `platform-data` | Избранные проекты, время последнего открытия, выбранный агент |
| `browser-profile` | Профиль Firefox (cookies, сессии) |
| `browser-config` | Конфигурация |

Токены сохраняются между перезапусками и пересборками — повторная авторизация не требуется.

Claude Code хранит состояние в двух местах: конфиг-каталог (`.credentials.json`, `settings.json`, сессии) и `$HOME/.claude.json` (флаг пройденного онбординга, аккаунт). Второй файл лежит рядом с каталогом, а не внутри него, поэтому при монтировании только `~/.claude` он терялся при каждой пересборке и CLI показывал мастер первого запуска, хотя токен был на месте. Контейнер задаёт `CLAUDE_CONFIG_DIR=/home/claude/.claude`, так что оба файла попадают в volume `claude-auth`. Побочный бонус: история сессий переживает пересборку, и `claude --continue` работает после неё.

## Команды

```bash
# Сборка
docker compose build

# Запуск
docker compose up -d

# Логи
docker compose logs -f

# Остановка
docker compose down

# Остановка с очисткой volumes (удалит авторизацию!)
docker compose down -v

# Горячая перезагрузка backend + frontend (правки видны без пересборки)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend

# Войти в Claude контейнер
docker exec -it ai-claude bash

# Войти в браузерный контейнер
docker exec -it ai-browser bash
```

## Разработка самой платформы

`docker-compose.dev.yml` поднимает backend через `tsx watch`, а frontend — через `vite` вместо nginx, с bind-маунтом `src/`. Правки в коде подхватываются сразу:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend
```

Профиль включается явно, а не через `docker-compose.override.yml`, потому что в нём UI отдаёт vite, а не nginx — значит не работают ни basic auth по `UI_PASSWORD`, ни `proxy_buffering off` для SSE-стрима Gemini. Всё, что затрагивает эти две вещи, проверяйте на обычной сборке.

Монтируется только `src/`: `node_modules` внутри образов собраны под musl (alpine), а установленные на хосте — под glibc, и подмена каталога целиком сломала бы нативные `node-pty` и `esbuild`. Новая зависимость в `package.json` по-прежнему требует пересборки образа.

**Не добавляйте в эту команду `claude-container`.** Веб-терминал и работающий в нём Claude живут в tmux внутри `ai-claude`, и пересоздание контейнера обрывает сессию. По той же причине `docker compose build && docker compose up -d` без имён сервисов убьёт активный диалог.

## Диагностика

### Прокси не работает

```bash
# Проверить redsocks
docker exec ai-gateway ps aux | grep redsocks

# Проверить iptables
docker exec ai-gateway iptables -t nat -L REDSOCKS -n -v

# Логи gateway
docker compose logs proxy-gateway
```

### Backend не отвечает

```bash
docker compose logs backend
docker exec ai-backend curl http://localhost:3000/api/health
```

### Frontend не загружается

```bash
docker compose logs frontend
curl http://localhost:9900
```

### Поблагодарить автора, на кофе и подписку
```
TRC20 TVnU9zWAEZdP2DfhQhKx3Zsiarn6uaHpzY
![TRC20](trc20.png)
```
