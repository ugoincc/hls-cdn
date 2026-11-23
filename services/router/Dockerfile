FROM node:22-alpine
# iproute2 → `tc netem` no link do cliente (requer cap NET_ADMIN no compose)
RUN apk add --no-cache iproute2
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY hashring.js server.js ./
COPY public/ public/
# hls.js vendorizado: servido pelo próprio router, sem CDN externa
RUN mkdir -p public/vendor && cp node_modules/hls.js/dist/hls.min.js public/vendor/
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server.js"]
