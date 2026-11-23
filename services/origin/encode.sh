#!/bin/sh
# Gera o conteúdo HLS (master + 3 renditions) a partir de fontes sintéticas do ffmpeg.
# Executado no build da imagem: reprodutível, sem download de vídeo.
set -eu

OUT=${1:-/srv/hls}
DUR=${DURATION:-180}      # duração em segundos
FPS=24
SEG=2                     # duração do segmento HLS (s)
GOP=$((FPS * SEG))        # keyframe a cada segmento → troca de qualidade em qualquer fronteira
FONT=/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf

mkdir -p "$OUT"

# encode <nome> <largura> <altura> <kbps vídeo> <nível h264>
encode() {
  name=$1; w=$2; h=$3; kbps=$4; level=$5
  mkdir -p "$OUT/$name"
  echo ">> $name ${w}x${h} ${kbps}k"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=${w}x${h}:rate=${FPS}:duration=${DUR}" \
    -f lavfi -i "sine=frequency=440:beep_factor=4:sample_rate=48000:duration=${DUR}" \
    -vf "drawtext=fontfile=${FONT}:text='${name}':x=40:y=40:fontsize=h/7:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=20,\
drawtext=fontfile=${FONT}:text='%{pts\:hms}':x=40:y=h-th-40:fontsize=h/10:fontcolor=yellow:box=1:boxcolor=black@0.65:boxborderw=15" \
    -c:v libx264 -preset veryfast -profile:v main -level:v "$level" -pix_fmt yuv420p \
    -b:v "${kbps}k" -minrate "${kbps}k" -maxrate "${kbps}k" -bufsize "$((kbps * 2))k" \
    -x264-params "nal-hrd=cbr:force-cfr=1" \
    -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
    -c:a aac -b:a 96k -ac 2 \
    -f hls -hls_time "$SEG" -hls_playlist_type vod \
    -hls_segment_filename "$OUT/$name/seg_%03d.ts" \
    "$OUT/$name/index.m3u8"
}

encode 360p   640  360  800 3.0
encode 720p  1280  720 2500 3.1
encode 1080p 1920 1080 5000 4.0

# Master playlist. BANDWIDTH = vídeo + áudio + ~10% de overhead do MPEG-TS (bits/s).
cat > "$OUT/master.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=990000,AVERAGE-BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2860000,AVERAGE-BANDWIDTH=2600000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5610000,AVERAGE-BANDWIDTH=5100000,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2"
1080p/index.m3u8
EOF

du -sh "$OUT"/*
