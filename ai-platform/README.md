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
| `claude-container` | Claude Code CLI + Node.js 22 + Git |
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

Вверху Dashboard — статус-панель: внешний IP через прокси (проверка kill switch), статус авторизации Claude и состояние контейнеров.

### Работа с Claude

1. Откройте проект — сессия Claude стартует автоматически (или кнопки **"Start Claude"** / **"Resume"** для продолжения последнего диалога / **"With task…"** для запуска сразу с задачей)
2. Вкладка **Claude** — терминал с Claude Code в директории проекта (Ctrl+F — поиск по выводу, ссылки кликабельны, A−/A＋ — размер шрифта)
3. Вкладка **Shell** — отдельный постоянный shell в том же контейнере (тесты, сборка)
4. На вкладке **Diff** просмотрите изменения
5. На вкладке **Git** — commit, rollback, переключение веток, pull/push
6. Когда Claude ждёт ввода или заканчивает работу — придёт уведомление (кнопка 🔔 на Dashboard включает браузерные уведомления; работает через hooks Claude Code)

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
- **Commit** — коммит с сообщением
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
| `claude-auth` | Токены авторизации Claude |
| `browser-profile` | Профиль Firefox (cookies, сессии) |
| `browser-config` | Конфигурация |

Токены сохраняются между перезапусками — повторная авторизация не требуется.

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

# Войти в Claude контейнер
docker exec -it ai-claude bash

# Войти в браузерный контейнер
docker exec -it ai-browser bash
```

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
