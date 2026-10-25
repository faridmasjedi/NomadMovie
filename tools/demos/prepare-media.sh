#!/bin/bash
# Prepares the footage for the website demos in tools/demos/work/media (macOS: uses `say` and `sips`).
# Demo footage: Tears of Steel (CC BY 3.0) © Blender Foundation | mango.blender.org
set -euo pipefail
cd "$(dirname "$0")"
FF="$(node -p 'require("ffmpeg-static")')"
W=work; M=$W/media; mkdir -p "$M"
FILM=$W/tears_of_steel_720p.mov
[ -s "$FILM" ] || curl -fL -o "$FILM" https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov
cut() { "$FF" -hide_banner -loglevel error -y -ss "$2" -t "$3" -i "$FILM" -vf "scale=-2:720,crop=1280:720" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ac 2 -movflags +faststart "$M/$1.mp4"; }
cut city 18.6 6; cut bridge 26 8; cut scope 103 6; cut ruins 121 7; cut room 173 7; cut street 265 8; cut oldstreet 225.5 8; cut lab 446 8
"$FF" -hide_banner -loglevel error -y -i "$M/street.mp4" -c copy "$M/street.mkv"
"$FF" -hide_banner -loglevel error -y -ss 592 -t 40 -i "$FILM" -vn -c:a aac -b:a 192k "$M/music.m4a"
for t in 30 265 228 175 450; do "$FF" -hide_banner -loglevel error -y -ss $t -i "$FILM" -vf "scale=-2:1080,crop=1920:1080" -frames:v 1 -q:v 2 "$M/photo_$t.jpg"; done
sips -s format heic "$M/photo_175.jpg" --out "$M/photo_room.heic" >/dev/null
# a picture-in-picture on pure green, for the chroma key demo
"$FF" -hide_banner -loglevel error -y -f lavfi -i color=c=0x00ff00:s=1280x720:d=6:r=30 -i "$M/scope.mp4" -filter_complex "[1:v]scale=480:-2[p];[0:v][p]overlay=x='100+t*100':y='120+40*sin(t*2)'" -an -c:v libx264 -crf 18 -pix_fmt yuv420p "$M/greenscreen.mp4"
say -v Samantha -o "$W/speech.aiff" "Welcome to my travel diary. [[slnc 1400]] Today we explore the old city by the canals. [[slnc 1600]] Every bridge here has a story. [[slnc 1200]] Let's go and find out."
"$FF" -hide_banner -loglevel error -y -i "$W/speech.aiff" -c:a aac -b:a 160k "$M/speech.m4a" && rm "$W/speech.aiff"
cp robot.svg stars.json "$M/"
echo "media ready in $M"
