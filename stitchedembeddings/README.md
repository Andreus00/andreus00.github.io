# Stitched Embeddings

Project page served at `/stitchedembeddings`.

## Customize

- Edit `index.html` — replace the placeholder title, authors, links, abstract,
  videos and text.
- Drop media into `static/`:
  - `static/videos/` — `.mp4` clips referenced from `index.html`.
  - `static/images/` — `interpolate_start.jpg`, `interpolate_end.jpg`, favicon, etc.
  - `static/interpolation/stacked/` — frames `000000.jpg`, `000001.jpg`, ... for the
    interpolation slider. After adding them, set `NUM_INTERP_FRAMES` in
    `static/js/index.js` to the frame count.

## Credits

Built on the [Nerfies](https://github.com/nerfies/nerfies.github.io) project-page
template, licensed under
[CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/).
