# Smith Solar — scroll site

Plain HTML / CSS / JS. GSAP 3.14 (ScrollTrigger, SplitText) and Lenis 1.3 load from jsDelivr.

## Run
Serve the folder over HTTP (the video is fetched into memory for smooth scrubbing, which file:// blocks):

    npx serve .        # or: python3 -m http.server

## Files
- index.html: markup for all sections
- css/style.css: design tokens at the top (:root), then one block per section
- js/main.js: one init function per section, called in page order
- assets/video/hero-scrub.mp4: your video re-encoded with every frame as a keyframe (needed for frame-accurate scroll scrubbing). If you swap the video, re-encode it the same way:

      ffmpeg -i in.mp4 -an -c:v libx264 -crf 24 -pix_fmt yuv420p -x264-params keyint=1:scenecut=0 -movflags +faststart hero-scrub.mp4

## Swapping the category images (section 6)
The six `<img data-cat-layer="N">` tags in `#categories` are placeholders. Replace each `src`; index N matches the `data-cat="N"` button.

## Tuning
- Hero scroll length: `window.innerHeight * 3` in initHero
- Card flip depth: the `58`, `-5` and `-220` values in initStatement's update()
- Stats squeeze width: `55.2%` in initStats (keep in sync with `.stats__panel` width)
- Smoothness: `lerp` in initLenis

Visitors with reduced motion turned on get a static layout with no pinning or smooth scroll.
