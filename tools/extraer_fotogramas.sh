#!/usr/bin/env bash
# Convierte un video en la secuencia de fotogramas que reproduce la portada al hacer scroll.
#
# Uso:   tools/extraer_fotogramas.sh video.mp4 [fps]
# Salida (raíz del repositorio):
#   assets/film/d/001.webp …   1600 px de ancho, para pantallas de 760 px o más
#   assets/film/m/001.webp …    900 px de ancho, para celular
#   assets/img/scene-{1,2,3}.webp   inicio, mitad y final del video (fondos y póster)
#
# Requisitos: ffmpeg con libwebp.
# Después de ejecutarlo, actualice data-frames="N" en tools/generar_paginas.py con el número
# que imprime este script y vuelva a generar las páginas.
#
# Recomendaciones para el video: una sola toma continua, sin cortes ni texto, movimiento de
# cámara a velocidad constante, 6–10 s. A 15 fps, 8 s son 121 fotogramas (≈5,5 MB en escritorio
# y ≈2,6 MB en celular), un buen equilibrio entre suavidad y peso.
set -euo pipefail

VIDEO="${1:?Uso: tools/extraer_fotogramas.sh video.mp4 [fps]}"
FPS="${2:-15}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$VIDEO")"

rm -rf "$ROOT/assets/film/d" "$ROOT/assets/film/m"
mkdir -p "$ROOT/assets/film/d" "$ROOT/assets/film/m" "$ROOT/assets/img"

ffmpeg -v error -y -i "$VIDEO" -vf "fps=$FPS,scale=1600:-2" -c:v libwebp -quality 60 -compression_level 6 "$ROOT/assets/film/d/%03d.webp"
ffmpeg -v error -y -i "$VIDEO" -vf "fps=$FPS,scale=900:-2"  -c:v libwebp -quality 55 -compression_level 6 "$ROOT/assets/film/m/%03d.webp"

i=1
for t in 0 "$(echo "$DUR / 2" | bc -l)" "$(echo "$DUR - 0.08" | bc -l)"; do
  ffmpeg -v error -y -ss "$t" -i "$VIDEO" -frames:v 1 -vf "scale=1920:-2" -c:v libwebp -quality 72 "$ROOT/assets/img/scene-$i.webp"
  i=$((i + 1))
done

N="$(ls "$ROOT/assets/film/d" | wc -l | tr -d ' ')"
echo "Fotogramas: $N  →  data-frames=\"$N\""
du -sh "$ROOT/assets/film/d" "$ROOT/assets/film/m"
