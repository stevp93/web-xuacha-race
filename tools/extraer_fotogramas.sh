#!/usr/bin/env bash
# Convierte un video en la secuencia de fotogramas que reproduce la portada al hacer scroll.
#
# Uso:   tools/extraer_fotogramas.sh video.mp4 [fps]
# Salida (raíz del repositorio):
#   assets/film/d/001.webp …   resolución nativa del video (horizontal), escritorio y tabletas
#   assets/film/m/001.webp …   recorte vertical 720×alto nativo, para celular en vertical.
#                              El recorte se desplaza de PAN_START a PAN_END del ancho durante el
#                              video para seguir al sujeto (ajústelos si el sujeto se mueve distinto).
#   assets/img/scene-{1,2,3}.webp   inicio, mitad y final del video (fondos y póster)
#
# Requisitos: ffmpeg con libwebp.
# Después de ejecutarlo, actualice data-frames="N" en tools/generar_paginas.py con el número
# que imprime este script y vuelva a generar las páginas.
#
# Recomendaciones para el video: una sola toma continua, sin cortes ni texto, movimiento de
# cámara a velocidad constante, 6–10 s. A 15 fps, 8 s son 121 fotogramas (≈5,5 MB en escritorio
# y ≈2,6 MB en celular), un buen equilibrio entre suavidad y peso.
# Con el video de 1924×1076 actual: ≈7,6 MB en escritorio y ≈3,6 MB en celular.
# Nunca reescale el celular a partir del ancho horizontal: en un teléfono el fotograma se ve
# por su altura y se amplía más de 3 veces (pixelado).
set -euo pipefail

VIDEO="${1:?Uso: tools/extraer_fotogramas.sh video.mp4 [fps]}"
FPS="${2:-15}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$VIDEO")"

rm -rf "$ROOT/assets/film/d" "$ROOT/assets/film/m"
mkdir -p "$ROOT/assets/film/d" "$ROOT/assets/film/m" "$ROOT/assets/img"

PAN_START="${PAN_START:-0.355}"
PAN_END="${PAN_END:-0.485}"
ffmpeg -v error -y -i "$VIDEO" -vf "fps=$FPS" -c:v libwebp -quality 66 -compression_level 6 "$ROOT/assets/film/d/%03d.webp"
ffmpeg -v error -y -i "$VIDEO" -vf "fps=$FPS,crop=720:ih:'iw*($PAN_START+($PAN_END-$PAN_START)*t/$DUR)-360':0" \
  -c:v libwebp -quality 74 -compression_level 6 "$ROOT/assets/film/m/%03d.webp"

i=1
for t in 0 "$(echo "$DUR / 2" | bc -l)" "$(echo "$DUR - 0.08" | bc -l)"; do
  ffmpeg -v error -y -ss "$t" -i "$VIDEO" -frames:v 1 -vf "scale=1920:-2" -c:v libwebp -quality 72 "$ROOT/assets/img/scene-$i.webp"
  i=$((i + 1))
done

N="$(ls "$ROOT/assets/film/d" | wc -l | tr -d ' ')"
echo "Fotogramas: $N  →  data-frames=\"$N\""
du -sh "$ROOT/assets/film/d" "$ROOT/assets/film/m"
