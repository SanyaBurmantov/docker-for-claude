Задача: создать локальную AI-разработческую платформу на базе Docker с Claude Code

Мне нужно разработать собственную локальную платформу для работы с Claude Code, которая будет работать как изолированная AI IDE-среда.

Цель: сделать аналог облачной среды разработки, но локально на моем ПК, где:

проекты выбираются через веб-интерфейс;
Claude Code работает внутри изолированного контейнера;
весь интернет-трафик идет только через прокси;
браузер, почта и авторизация Claude находятся внутри этой среды;
я вижу изменения, которые предлагает Claude;
могу принимать или отклонять изменения;
могу работать с несколькими проектами.
Основная архитектура

Нужно создать Docker-based платформу:

Host machine
│
│
├── Web Interface
│       │
│       ├── Project manager
│       ├── File explorer
│       ├── Claude session manager
│       ├── Diff viewer
│       └── Settings
│
│
Docker environment
│
├── Backend API
│
├── Claude Code container
│       │
│       ├── Ubuntu
│       ├── Node.js
│       ├── Claude Code CLI
│       ├── Git
│       ├── Development tools
│       └── Project workspace
│
├── Browser container
│       │
│       ├── Chromium/Firefox
│       ├── Persistent profile
│       ├── Claude OAuth login
│       └── Email client
│
├── Desktop environment
│       │
│       ├── XFCE
│       └── noVNC access
│
└── Network gateway
│
├── sing-box/tun2socks/redsocks
├── Proxy routing
└── Kill switch

              |
              |
          HTTP Proxy
Требование 1: веб-платформа

Создать веб-интерфейс, доступный например:

http://localhost:3000

Функциональность:

Главная страница

Должна показывать:

список доступных проектов;
путь проекта;
размер;
последнюю активность;
активную Claude-сессию.

Пример:

Projects

[x] shop-frontend
/home/user/projects/shop
Claude running

[x] api-service
/home/user/projects/api
Offline
Требование 2: выбор проекта

Я хочу выбрать любой проект на своем компьютере.

Например:

C:\Users\User\projects\my-app

или

/home/user/projects/my-app

После выбора:

платформа должна:

создать рабочий контейнер;
примонтировать проект;
открыть Claude Code в этом проекте;
открыть терминал Claude через веб-интерфейс.

Например:

Нажимаю:

Open with Claude

Получаю:

~/workspace/my-app

claude >
Требование 3: интерфейс Claude

Нужно сделать веб-терминал:

Пример:

------------------------------------------------

Claude Code

> Analyze this component

Claude:

I found problems:
- App.vue
- api.js


Changes:

+ added validation
+ changed API request


[Accept]
[Reject]
[Review]

------------------------------------------------
Требование 4: просмотр изменений

Очень важно.

Я должен видеть изменения Claude до применения.

Нужно реализовать:

git diff;
просмотр измененных файлов;
подсветку изменений;
выбор отдельных изменений.

Пример:

src/App.vue


+ const user = await fetchUser()

- oldFunction()


Apply this change?
YES / NO
Требование 5: Git интеграция

Каждый проект должен работать через git.

Перед изменениями:

автоматически:

git checkout -b claude-session-123

Claude работает в своей ветке.

После изменений:

кнопки:

Commit
Rollback
Merge
Discard
Требование 6: браузер внутри среды

Claude требует OAuth авторизацию.

Поэтому браузер должен быть частью системы.

Требования:

Firefox или Chromium;
запуск внутри контейнера;
доступ через веб:
http://localhost:6080
сохранение cookies;
сохранение профиля;
повторный вход не требуется.

В браузере должны работать:

Claude login;
почта;
OAuth;
подтверждения.
Требование 7: почтовый клиент

Нужно предусмотреть работу с почтой внутри той же среды.

Варианты:

Thunderbird;
Chromium webmail;
отдельный контейнер.

Требования:

авторизация сохраняется;
браузер и почта работают через тот же прокси;
можно получать письма для подтверждения входа.
Требование 8: прокси и безопасность

Мой прокси:

Host:
88.218.50.200

Port:
8000

Username:
k0J9gL

Password:
8LyqEt

Вся система должна работать через него.

Нельзя:

прямой выход Claude;
прямой выход браузера;
прямой выход почты.

Нужно реализовать:

network gateway;
transparent proxy;
kill switch.

Если прокси умер:

Internet access = disabled
Требование 9: сохранение состояния

После перезапуска:

должны сохраняться:

Claude авторизация;
браузер;
почта;
проекты;
настройки;
история сессий.

Использовать:

Docker volumes.

Требование 10: технологии

Предложи оптимальный стек.

Предпочтительно:

Backend:

Node.js
NestJS или Express

Frontend:

React / Vue
TypeScript

Terminal:

xterm.js

File explorer:

Monaco Editor или аналог

Diff:

Monaco Diff Editor

Containers:

Docker Compose

Network:

sing-box / tun2socks
Требование 11: пользовательский сценарий

После установки:

docker compose up -d

Открываю:

http://localhost:3000

Вижу платформу.

Дальше:

Выбираю проект.
Нажимаю "Start Claude".
Открывается Claude terminal.
Claude анализирует проект.
Показывает изменения.
Я принимаю изменения.
Они применяются в проект.
Делаю commit.
Требование 12: результат

Нужно предоставить:

Полный проект:

ai-platform/

├── frontend/
│
├── backend/
│
├── docker/
│
├── claude-container/
│
├── browser-container/
│
├── proxy-gateway/
│
├── docker-compose.yml
│
├── .env.example
│
└── README.md

Нужно написать:

весь код;
Dockerfile;
docker-compose;
конфиги;
инструкции запуска;
описание архитектуры;
команды диагностики.
Дополнительное требование

Не делать упрощенную версию.

Мне нужна именно локальная AI-разработка-платформа:

как мини-Cursor;
как локальный Replit;
как собственная Claude IDE;
с контролем сети;
с проектами;
с браузером;
с авторизацией;
с просмотром изменений.

Этот промт даст другой нейросети понять, что речь уже не о контейнере, а о полноценной локальной платформе.