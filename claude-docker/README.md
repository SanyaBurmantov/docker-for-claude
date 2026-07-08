# Claude Docker Environment

Изолированное Docker-окружение для Claude Code CLI с принудительным проксированием всего трафика.

## Архитектура

```
Host machine
|
|
Docker container (claude-env)
|
├── Ubuntu 24.04
├── Node.js LTS (22.x)
├── Claude Code CLI
├── Firefox
├── XFCE Desktop
├── noVNC (http://localhost:6080)
├── redsocks (transparent proxy)
├── iptables (kill switch)
└── Полная изоляция сети
|
|
HTTP/HTTPS Proxy (88.218.50.200:8000)
|
|
Internet
```

## Требования

- Docker Engine 24+
- Docker Compose v2+

## Быстрый старт

### 1. Клонировать и настроить

```bash
cd claude-docker
```

Проверьте и отредактируйте `.env` при необходимости:

```bash
cat .env
```

### 2. Собрать и запустить

```bash
docker compose build
docker compose up -d
```

### 3. Открыть noVNC

Откройте в браузере: **http://localhost:6080**

Вы увидите рабочий стол XFCE внутри контейнера.

### 4. Авторизовать Claude

- Откройте терминал через меню `Applications > Terminal`
- Выполните:
  ```bash
  claude
  ```
- Claude откроет браузер для OAuth-авторизации
- Войдите в свою учетную запись Anthropic
- Токен сохранится в volume `claude-auth`

### 5. Ежедневное использование

```bash
# Войти в контейнер
docker exec -it claude-env bash

# Запустить Claude
claude
```

Или используйте helper-скрипт:

```bash
chmod +x claude-box.sh
./claude-box.sh
```

## Работа с проектами

Проекты монтируются в `/workspace`:

- `/workspace/host-projects` — ваши проекты с хоста (из `~/projects`, read-only)
- `/workspace/` — рабочая директория внутри контейнера (persistent volume)

```bash
# Внутри контейнера
cd /workspace
mkdir my-project
cd my-project
claude
```

## Проверки

### Проверка внешнего IP

```bash
curl https://api.ipify.org
# Ожидаемый результат: 88.218.50.200 (IP прокси)
```

### Проверка блокировки прямого доступа

```bash
# Этот запрос должен зависнуть или вернуть ошибку
curl --max-time 5 http://ifconfig.me
```

### Проверка DNS

```bash
nslookup google.com
```

### Проверка kill switch

```bash
# Остановите redsocks
pkill redsocks

# Любой запрос к внешнему ресурсу должен завершиться ошибкой
curl --max-time 5 https://example.com
# Ожидаемый результат: timeout / connection refused
```

## Диагностика

### Прокси не работает

```bash
# Проверить, запущен ли redsocks
ps aux | grep redsocks

# Проверить iptables rules
iptables -t nat -L REDSOCKS -n -v

# Проверить логи redsocks (они идут в stderr контейнера)
docker logs claude-env

# Проверить доступность прокси
curl -x "http://k0J9gL:8LyqEt@88.218.50.200:8000" https://api.ipify.org
```

### Сбросить iptables

```bash
iptables -t nat -F
iptables -F
```

### Перезапустить redsocks

```bash
pkill redsocks
redsocks -c /etc/redsocks.conf &
```

## Volumes

| Volume | Назначение |
|--------|-----------|
| `claude-auth` | Токены авторизации Claude (OAuth) |
| `claude-browser` | Профиль Firefox (cookies, сессии) |
| `claude-config` | Конфигурационные файлы |
| `claude-workspace` | Рабочие проекты |

Токены авторизации сохраняются между перезапусками — не нужно логиниться каждый раз.

## Сеть

### Как это работает

1. **redsocks** слушает на `127.0.0.1:12345`
2. **iptables** перенаправляет весь TCP-трафик (кроме локального и трафика к прокси) на redsocks
3. **redsocks** преобразует трафик в HTTP-прокси запросы с аутентификацией
4. Если redsocks падает — iptables отправляет трафик в никуда (kill switch)
5. Весь UDP-трафик, кроме DNS, блокируется

### Kill Switch

Если прокси-сервер недоступен или redsocks остановлен:
- Все TCP-соединения к внешним хостам обрываются (REDIRECT на закрытый порт)
- DNS продолжает работать, но данные не передаются
- Контейнер полностью теряет доступ в интернет

## Команды

```bash
# Сборка
docker compose build

# Запуск
docker compose up -d

# Остановка
docker compose down

# Перезапуск
docker compose restart

# Просмотр логов
docker compose logs -f

# Вход в контейнер
docker exec -it claude-env bash

# Очистка volumes (удалит авторизацию!)
docker compose down -v
```
