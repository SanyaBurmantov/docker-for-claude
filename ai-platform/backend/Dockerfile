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
EXPOSE 3000
CMD ["node", "dist/index.js"]
