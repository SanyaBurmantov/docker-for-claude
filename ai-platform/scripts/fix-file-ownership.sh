#!/usr/bin/env bash
#
# Одноразовая миграция: файлы в PROJECTS_DIR перестают принадлежать root.
#
# Контейнеры backend и claude раньше работали от uid 0, а /workspace — это bind mount,
# который пробрасывает числовой uid на хост как есть. Поэтому всё, что создавал агент
# или веб-редактор, появлялось на хосте с владельцем root, и IDE не могла снять
# read-only: chmod разрешён только владельцу.
#
# Скрипт чинит прошлое (chown уже созданных файлов) и включает будущее (пересобирает
# образы с вашим uid/gid). Идемпотентен: повторный запуск ничего не ломает.
#
# Запускать на хосте, от своего пользователя (не через sudo), из любого каталога.

set -euo pipefail

# ── 0. Проверки окружения ────────────────────────────────────────────────────

if [ -f /.dockerenv ]; then
  echo "ОШИБКА: скрипт запущен внутри контейнера. Он предназначен для хоста." >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  echo "ОШИБКА: не запускайте через sudo — скрипту нужен uid вашего пользователя," >&2
  echo "        а sudo он вызовет сам там, где это действительно нужно." >&2
  exit 1
fi

command -v docker >/dev/null || { echo "ОШИБКА: docker не найден в PATH" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ОШИБКА: нет доступа к docker (нужна группа docker?)" >&2; exit 1; }

# Каталог ai-platform: рядом со скриптом, на уровень выше
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f docker-compose.yml ] || { echo "ОШИБКА: docker-compose.yml не найден в $PWD" >&2; exit 1; }
[ -f .env ] || { echo "ОШИБКА: .env не найден в $PWD (скопируйте .env.example)" >&2; exit 1; }

# ── 1. Значения, специфичные для этой машины ─────────────────────────────────

HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

# На части систем группы docker нет (rootless, Docker Desktop) — тогда берём
# группу-владельца самого сокета: именно она даёт к нему доступ.
DOCKER_GID="$(getent group docker | cut -d: -f3 || true)"
if [ -z "$DOCKER_GID" ] && [ -S /var/run/docker.sock ]; then
  DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
fi
[ -n "$DOCKER_GID" ] || { echo "ОШИБКА: не удалось определить DOCKER_GID" >&2; exit 1; }

# Вписываем ключ в .env, не плодя дублей: правим существующую строку или дописываем.
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

set_env HOST_UID  "$HOST_UID"
set_env HOST_GID  "$HOST_GID"
set_env DOCKER_GID "$DOCKER_GID"
echo "→ .env: HOST_UID=$HOST_UID HOST_GID=$HOST_GID DOCKER_GID=$DOCKER_GID"

PROJECTS_DIR="$(grep -E '^PROJECTS_DIR=' .env | cut -d= -f2-)"
[ -n "$PROJECTS_DIR" ] && [ -d "$PROJECTS_DIR" ] \
  || { echo "ОШИБКА: PROJECTS_DIR из .env не указывает на существующий каталог: '$PROJECTS_DIR'" >&2; exit 1; }

# ── 2. Прошлое: вернуть владельца уже созданным файлам ───────────────────────

# Точечно, только root-owned. Слепой `chown -R` тронул бы 600k+ файлов и затёр бы
# чужого владельца, если в каталоге лежит что-то не ваше. -h не разыменовывает симлинки,
# -xdev не уходит в другие ФС (например, в примонтированный внутрь каталог).
echo "→ Ищу файлы, принадлежащие root, в $PROJECTS_DIR ..."
root_owned="$(sudo find "$PROJECTS_DIR" -xdev \( -uid 0 -o -gid 0 \) -printf '.' 2>/dev/null | wc -c)"

if [ "$root_owned" -gt 0 ]; then
  echo "→ Найдено $root_owned объектов. Меняю владельца на ${HOST_UID}:${HOST_GID} ..."
  sudo find "$PROJECTS_DIR" -xdev \( -uid 0 -o -gid 0 \) -exec chown -h "${HOST_UID}:${HOST_GID}" {} +
else
  echo "→ Файлов root не найдено, пропускаю."
fi

# ── 3. Остановка стека ───────────────────────────────────────────────────────

echo "→ docker compose down"
echo "  (контейнер ai-claude тоже будет остановлен)"
docker compose down

# ── 4. Именованный том platform-data ─────────────────────────────────────────

# Backend теперь непривилегированный и сам этот том не почините: Docker создал его
# от root. Новый том унаследует владельца из образа, а вот уже существующий надо
# перебрать снаружи — разово, контейнером, который ещё имеет право на chown.
volumes="$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)platform-data$' || true)"
volume_count="$(printf '%s' "$volumes" | grep -c . || true)"

if [ "$volume_count" -eq 1 ]; then
  echo "→ Чиню владельца тома $volumes"
  docker run --rm -v "$volumes:/data" alpine chown -R "${HOST_UID}:${HOST_GID}" /data
elif [ "$volume_count" -eq 0 ]; then
  echo "→ Тома platform-data нет — будет создан при первом старте с нужным владельцем."
else
  echo "ВНИМАНИЕ: найдено несколько томов platform-data, не угадываю какой ваш:" >&2
  printf '  %s\n' $volumes >&2
  echo "Почините нужный вручную:" >&2
  echo "  docker run --rm -v <том>:/data alpine chown -R ${HOST_UID}:${HOST_GID} /data" >&2
  exit 1
fi

# ── 5. Будущее: пересборка образов с вашим uid ───────────────────────────────

# HOST_UID приходит build-аргументом: пользователь `claude` создаётся с этим uid
# на этапе сборки, поэтому одного рестарта недостаточно — нужен build.
echo "→ docker compose build"
docker compose build

echo "→ docker compose up -d"
docker compose up -d

# ── 6. Проверка ──────────────────────────────────────────────────────────────

left="$(sudo find "$PROJECTS_DIR" -xdev \( -uid 0 -o -gid 0 \) -printf '.' 2>/dev/null | wc -c)"
echo
if [ "$left" -eq 0 ]; then
  echo "ГОТОВО. Файлов, принадлежащих root, в $PROJECTS_DIR не осталось."
  echo "Новые файлы backend и агент будут создавать от ${HOST_UID}:${HOST_GID}."
else
  echo "ВНИМАНИЕ: осталось $left объектов root. Показать: " >&2
  echo "  sudo find '$PROJECTS_DIR' -xdev \( -uid 0 -o -gid 0 \) | head" >&2
  exit 1
fi
