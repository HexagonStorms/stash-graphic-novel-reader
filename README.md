# Graphic Novel Reader

A touch-friendly, full-screen reading mode for [Stash](https://github.com/stashapp/stash) image galleries: manga, Western comics, doujin, art books, anything that is *pages you turn*.

Stash treats a gallery as a bag of images. This plugin treats it as a book. It adds a **Read** button to galleries and opens an immersive page-turner on top of the Stash UI.

## Features

- **Tap-zone paging** — tap the right third of the screen to go forward, the left third to go back, the center to show/hide the controls. One press, instant.
- **Swipe paging** — swipe left to go forward, right to go back (mirrored in right-to-left mode). Ignored while zoomed in, where dragging pans instead.
- **Pinch to zoom that never flips the page** — while you are pinching or zoomed in, taps pan the image instead of turning the page. A short cooldown after a pinch prevents the stray flip when you lift your fingers unevenly. Mouse wheel zooms on desktop.
- **Optional page-turn animation** — a slide transition you can toggle on or off, live, from inside the reader (or set a default in plugin settings). Off means instant cuts.
- **Right-to-left support** — flip reading direction for manga; tap zones flip with it.
- **Resume where you left off** — each gallery remembers its last page.
- **Keyboard** — arrow keys, WASD, or space to page, `0` to reset zoom, `h` to hide controls, `Esc` to exit.

## How it maps onto Stash

A **gallery = a book**, its **images = pages**. The plugin reads page order from the gallery's images sorted by path, so name your pages so they sort correctly (`001.jpg`, `002.jpg`, …). Tag and title the *gallery* — artist as performer, circle/magazine as studio, parody/characters/language as tags — exactly as you would any gallery. Nothing about your library changes; this is only a viewer.

## Install

The plugin is plain JavaScript and CSS, no build step.

Drop the folder into your Stash `plugins` directory, then **Settings → Plugins → Reload plugins**.

```sh
# from this repo, into a local Stash plugins dir
cp -r stash-graphic-novel-reader /path/to/.stash/plugins/

# or keep it as a live checkout with a symlink (handy while iterating)
ln -s "$PWD/stash-graphic-novel-reader" /path/to/.stash/plugins/graphic-novel-reader
```

For the Docker `stashapp/stash` image, the plugins directory is `<your stash config volume>/plugins` (the path mapped to `/root/.stash` inside the container).

After reloading, open any gallery with images and click **Read**, or use the Read button on gallery cards in lists.

## Settings

**Settings → Plugins → Graphic Novel Reader**

| Setting | Default | Effect |
|---|---|---|
| Page-turn animations | on | Default for the slide transition (toggle live in the reader too). |
| Right-to-left by default | off | Open galleries in manga reading order. |
| Read button on gallery cards | on | Show the quick Read overlay on cards in lists. |

In-reader toggles are remembered per browser and take precedence over the server defaults once you have used them.

## Compatibility

Built against the Stash UI plugin API (`PluginApi.register.route`, `PluginApi.patch.after`) using the `GalleryCard.Overlays` and `GalleryImagesPanel` patch points. Requires a Stash version new enough to expose those. No external dependencies.

## License

MIT. See [LICENSE](LICENSE).
