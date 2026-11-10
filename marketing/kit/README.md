# Wraith Transmission Kit

One template for every poster and video, so everything Wraith posts looks the same.

Edit `specs.js`, then from the repo root:

    node marketing/kit/build.js     # PNG posters: 1600x900 (X) and 1080x1350 (portrait) -> marketing/out/posters
    node marketing/kit/video.js     # 6 s MP4s (needs ffmpeg on PATH) -> marketing/out/videos

Spec fields: type, n (post number), title, sub, chips[], tier (shade|specter|wraith, optional).

Types: SIGHTING (new feature, orange) | TRANSMISSION (update, teal) | GATHERING (event, purple) | ASCENDED (milestone, gold) | WARNING (scam/safety, red) | RANKUP (tier news, orange).
