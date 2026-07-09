FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
# htpasswd for optional basic auth (enabled via UI_PASSWORD)
RUN apk add --no-cache apache2-utils && touch /etc/nginx/auth.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY auth-setup.sh /docker-entrypoint.d/40-auth.sh
RUN chmod +x /docker-entrypoint.d/40-auth.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
