# AI Platform Desktop

Desktop-оболочка для уже запущенной Docker-платформы. Основное окно открывает
`http://localhost:9900`, а Voice Helper получает отдельное always-on-top окно.

```bash
cd ai-platform/desktop
npm install
npm start
```

Сборка установщика под текущую ОС:

```bash
npm run dist:win       # Windows, NSIS (.exe)
npm run dist:linux     # Linux, AppImage
```

Docker Compose остаётся отдельным сервисом и должен запускаться как раньше.
Если платформа слушает не `localhost:9900`, задайте адрес перед запуском:

```bash
AI_PLATFORM_URL=http://127.0.0.1:9900 npm start
```

На Windows `System audio` использует нативный loopback текущего экрана. На Linux
VC ищет вход `Monitor of …` / `monitor` из PulseAudio или PipeWire. Если система
его не публикует, включите monitor-source в настройках звука либо выберите
`Microphone`; сам микрофон работает одинаково на обеих системах.
