# Estágio 1: gera o HLS com ffmpeg (só no build).
FROM alpine:3.20 AS encoder
RUN apk add --no-cache ffmpeg font-dejavu
ARG DURATION=180
ENV DURATION=${DURATION}
COPY encode.sh /encode.sh
RUN sh /encode.sh /srv/hls

# Estágio 2: imagem final enxuta (node + arquivos gerados, sem ffmpeg).
FROM node:22-alpine
WORKDIR /app
COPY --from=encoder /srv/hls /srv/hls
COPY package.json server.js ./
ENV PORT=8080 CONTENT_DIR=/srv/hls
EXPOSE 8080
CMD ["node", "server.js"]
