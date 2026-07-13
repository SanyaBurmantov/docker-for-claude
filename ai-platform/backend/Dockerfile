FROM node:22-alpine AS builder
WORKDIR /app
# python3/make/g++ are needed to compile node-pty's native bindings
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine
RUN apk add --no-cache git docker-cli python3 make g++ tar
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist/ ./dist/

# The backend writes into the bind-mounted /workspace (file saves, uploads, new
# projects), so compose runs it as the host user rather than root — otherwise the
# files it creates are root-owned on the host. DATA_DIR is a named volume, and Docker
# seeds a fresh volume with the ownership of this directory, so it must be prepared
# here: a non-root process cannot chown it later.
ARG HOST_UID=1000
ARG HOST_GID=1000
RUN mkdir -p /data && chown ${HOST_UID}:${HOST_GID} /data

EXPOSE 3000
CMD ["node", "dist/index.js"]
