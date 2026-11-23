FROM node:22-alpine
# iproute2 → `tc netem` para injetar latência/perda (requer cap NET_ADMIN no compose)
RUN apk add --no-cache iproute2
WORKDIR /app
COPY package.json lru.js server.js ./
ENV PORT=8081
CMD ["node", "server.js"]
