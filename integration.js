// Graphic Novel Reader - integration.js
// Patches Stash gallery components to add "Read" entry points that link to the
// reader route registered in reader.js.
(function () {
  "use strict";

  const PluginApi = window.PluginApi;
  if (!PluginApi || !PluginApi.React) {
    console.error("[GNR] PluginApi or React not available; integration not loaded.");
    return;
  }

  const React = PluginApi.React;
  const h = React.createElement;
  const RRD = PluginApi.libraries.ReactRouterDOM || {};
  const Link = RRD.Link;

  const PLUGIN_ID = (window.GNR && window.GNR.PLUGIN_ID) || "graphic-novel-reader";
  const readerPath = (window.GNR && window.GNR.readerPath) || ((id) => `/plugins/graphic-novel-reader/${id}`);

  // ---- shared, cached read of the "readButtonOnCards" server setting --------
  let cardSettingPromise = null;
  function getCardEnabled() {
    if (!cardSettingPromise) {
      cardSettingPromise = fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ query: "query { configuration { plugins } }" }),
      })
        .then((r) => r.json())
        .then((j) => {
          const cfg = j && j.data && j.data.configuration && j.data.configuration.plugins
            ? j.data.configuration.plugins[PLUGIN_ID] : null;
          // default on; only false when explicitly disabled
          return !(cfg && cfg.readButtonOnCards === false);
        })
        .catch(() => true);
    }
    return cardSettingPromise;
  }

  function ReadIcon() {
    return h("span", { className: "gnr-book", "aria-hidden": "true" }, "📖");
  }

  // small Link-as-button; falls back to an anchor if Router Link is missing
  function ReadButton(props) {
    const to = readerPath(props.id);
    const cls = props.className;
    const children = [h(ReadIcon, { key: "i" }), props.label ? h("span", { key: "l" }, " " + props.label) : null];
    if (Link) return h(Link, { to: to, className: cls, title: "Read", onClick: stop }, children);
    return h("a", { href: to, className: cls, title: "Read", onClick: stop }, children);
  }
  function stop(e) { e.stopPropagation(); }

  // ---- card overlay button (gallery lists) ----------------------------------
  function CardReadButton(props) {
    const [enabled, setEnabled] = React.useState(true);
    React.useEffect(() => {
      let on = true;
      getCardEnabled().then((v) => { if (on) setEnabled(v); });
      return () => { on = false; };
    }, []);
    if (!enabled) return null;
    if (!props.id) return null;
    if (props.imageCount === 0) return null; // nothing to read
    return h(ReadButton, { id: props.id, className: "gnr-card-read-btn" });
  }

  // after-hooks receive (props, context, result); the rendered output is the THIRD arg
  PluginApi.patch.after("GalleryCard.Overlays", function (props, _ctx, result) {
    const gallery = props && props.gallery;
    const id = gallery && gallery.id;
    if (!id) return result;
    return h(React.Fragment, null,
      result,
      h(CardReadButton, { id: id, imageCount: gallery.image_count })
    );
  });

  // ---- detail page: Read bar above the Images panel -------------------------
  PluginApi.patch.after("GalleryImagesPanel", function (props, _ctx, result) {
    const gallery = props && props.gallery;
    const id = gallery && gallery.id;
    const count = gallery && gallery.image_count;
    if (!id || !count) return result;
    const bar = h("div", { className: "gnr-panel-bar", key: "gnr-bar" },
      h(ReadButton, { id: id, className: "btn btn-primary gnr-read-btn", label: "Read" })
    );
    return h(React.Fragment, null, bar, result);
  });
})();
