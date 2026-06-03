// Graphic Novel Reader - reader.js
// Registers the /plugins/graphic-novel-reader/:id route and renders the
// full-screen page-turner. No build step: plain JS against window.PluginApi.
(function () {
  "use strict";

  const PluginApi = window.PluginApi;
  if (!PluginApi || !PluginApi.React) {
    console.error("[GNR] PluginApi or React not available; reader not loaded.");
    return;
  }

  const React = PluginApi.React;
  const { useState, useEffect, useRef, useCallback } = React;
  const h = React.createElement;
  const RRD = PluginApi.libraries.ReactRouterDOM || {};

  // ---- constants & small helpers --------------------------------------------

  const PLUGIN_ID = "graphic-novel-reader"; // key under configuration.plugins
  const PREFS_KEY = "gnr:prefs";
  const pageKey = (gid) => `gnr:gallery:${gid}:page`;
  const ROUTE = "/plugins/graphic-novel-reader/:id";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const DEFAULT_PREFS = { animations: true, rtl: false };

  function loadPrefs() {
    try {
      return Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem(PREFS_KEY)) || {});
    } catch (e) {
      return Object.assign({}, DEFAULT_PREFS);
    }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }
  // which pref keys the user has explicitly set (so server defaults don't clobber them)
  function storedPrefKeys() {
    try { return Object.keys(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch (e) { return []; }
  }

  async function gql(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json.data;
  }

  const DATA_QUERY = `
    query GNRGallery($id: ID!) {
      findGallery(id: $id) { id title image_count }
      findImages(
        filter: { per_page: -1, sort: "path", direction: ASC }
        image_filter: { galleries: { value: [$id], modifier: INCLUDES } }
      ) {
        images { id title paths { image thumbnail } }
      }
    }`;

  // Server-side plugin settings -> seed defaults the first time, before the
  // user has set anything locally. Best-effort: failure just keeps defaults.
  async function fetchServerPrefs() {
    try {
      const data = await gql(`query { configuration { plugins } }`, {});
      const cfg = data && data.configuration && data.configuration.plugins
        ? data.configuration.plugins[PLUGIN_ID]
        : null;
      if (!cfg) return null;
      const seed = {};
      if (typeof cfg.pageAnimations === "boolean") seed.animations = cfg.pageAnimations;
      if (typeof cfg.defaultRightToLeft === "boolean") seed.rtl = cfg.defaultRightToLeft;
      return seed;
    } catch (e) {
      return null;
    }
  }

  // ---- the reader component --------------------------------------------------

  function GraphicNovelReader() {
    const params = RRD.useParams ? RRD.useParams() : {};
    const history = RRD.useHistory ? RRD.useHistory() : null;
    const galleryId = params.id;

    const [state, setState] = useState({ loading: true, error: null, title: "", images: [] });
    const [page, setPage] = useState(0);
    const [prefs, setPrefs] = useState(loadPrefs);
    const [chrome, setChrome] = useState(true);
    const [zoomed, setZoomed] = useState(false);
    const [dir, setDir] = useState("next"); // slide direction for the page-turn animation

    const stageRef = useRef(null);
    const imgRef = useRef(null);

    const total = state.images.length;

    // gesture state kept off-React so pointer moves don't trigger re-renders
    const g = useRef({
      scale: 1, tx: 0, ty: 0,
      pointers: new Map(),
      startDist: 0, startScale: 1,
      downX: 0, downY: 0, downT: 0, lastX: 0, lastY: 0, moved: 0,
      lastPinchEnd: 0,
    });

    // refs mirrored each render so the (once-bound) native handlers stay fresh
    const pageRef = useRef(0); pageRef.current = page;
    const totalRef = useRef(0); totalRef.current = total;
    const prefsRef = useRef(prefs); prefsRef.current = prefs;
    const zoomedRef = useRef(false);
    const navRef = useRef({ next: () => {}, prev: () => {}, toggleChrome: () => {}, exit: () => {} });

    // ---- load gallery + images ---------------------------------------------
    useEffect(() => {
      let alive = true;
      setState({ loading: true, error: null, title: "", images: [] });
      gql(DATA_QUERY, { id: galleryId })
        .then((data) => {
          if (!alive) return;
          const gallery = data.findGallery;
          const images = (data.findImages && data.findImages.images) || [];
          const title = (gallery && gallery.title) || "Gallery " + galleryId;
          setState({ loading: false, error: null, title, images });
          // resume where we left off
          let resume = 0;
          try { resume = parseInt(localStorage.getItem(pageKey(galleryId)) || "0", 10) || 0; } catch (e) {}
          setPage(clamp(resume, 0, Math.max(0, images.length - 1)));
        })
        .catch((err) => {
          if (!alive) return;
          setState({ loading: false, error: String(err.message || err), title: "", images: [] });
        });
      return () => { alive = false; };
    }, [galleryId]);

    // seed prefs from server settings only for keys the user hasn't set locally
    useEffect(() => {
      let alive = true;
      fetchServerPrefs().then((seed) => {
        if (!alive || !seed) return;
        const locked = new Set(storedPrefKeys());
        setPrefs((p) => {
          const next = Object.assign({}, p);
          Object.keys(seed).forEach((k) => { if (!locked.has(k)) next[k] = seed[k]; });
          return next;
        });
      });
      return () => { alive = false; };
    }, []);

    // persist current page for resume
    useEffect(() => {
      if (!state.loading && total > 0) {
        try { localStorage.setItem(pageKey(galleryId), String(page)); } catch (e) {}
      }
    }, [page, galleryId, state.loading, total]);

    // preload neighbours
    useEffect(() => {
      [page + 1, page + 2, page - 1].forEach((i) => {
        const img = state.images[i];
        if (img && img.paths && img.paths.image) {
          const pre = new Image();
          pre.src = img.paths.image;
        }
      });
    }, [page, state.images]);

    // ---- zoom/pan plumbing --------------------------------------------------
    const applyTransform = useCallback(() => {
      const el = imgRef.current;
      if (el) {
        const s = g.current;
        el.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
      }
    }, []);

    const clampPan = useCallback(() => {
      const el = imgRef.current, st = stageRef.current;
      if (!el || !st) return;
      const s = g.current;
      const maxX = Math.max(0, (el.clientWidth * s.scale - st.clientWidth) / 2);
      const maxY = Math.max(0, (el.clientHeight * s.scale - st.clientHeight) / 2);
      s.tx = clamp(s.tx, -maxX, maxX);
      s.ty = clamp(s.ty, -maxY, maxY);
    }, []);

    const resetZoom = useCallback(() => {
      const s = g.current;
      s.scale = 1; s.tx = 0; s.ty = 0;
      if (zoomedRef.current) { zoomedRef.current = false; setZoomed(false); }
      applyTransform();
    }, [applyTransform]);

    const setZoom = useCallback((scale) => {
      const s = g.current;
      s.scale = clamp(scale, 1, 5);
      if (s.scale <= 1.02) { resetZoom(); return; }
      if (!zoomedRef.current) { zoomedRef.current = true; setZoomed(true); }
      clampPan();
      applyTransform();
    }, [applyTransform, clampPan, resetZoom]);

    // ---- navigation ---------------------------------------------------------
    const goTo = useCallback((idx, direction) => {
      const t = totalRef.current;
      if (idx < 0 || idx >= t) return;
      setDir(direction || (idx > pageRef.current ? "next" : "prev"));
      resetZoom();
      setPage(idx);
    }, [resetZoom]);

    // keep the handler-facing nav callbacks current
    navRef.current = {
      next: () => goTo(pageRef.current + 1, "next"),
      prev: () => goTo(pageRef.current - 1, "prev"),
      toggleChrome: () => setChrome((c) => !c),
      exit: () => {
        if (history) history.push(`/galleries/${galleryId}`);
        else window.location.assign(`/galleries/${galleryId}`);
      },
    };

    const handleTap = useCallback((clientX) => {
      const st = stageRef.current;
      if (!st) return;
      const rect = st.getBoundingClientRect();
      const f = (clientX - rect.left) / rect.width;
      const rtl = prefsRef.current.rtl;
      if (f < 0.33) {
        rtl ? navRef.current.next() : navRef.current.prev();
      } else if (f > 0.67) {
        rtl ? navRef.current.prev() : navRef.current.next();
      } else {
        navRef.current.toggleChrome();
      }
    }, []);

    // ---- bind native pointer/wheel handlers once ----------------------------
    useEffect(() => {
      const st = stageRef.current;
      if (!st) return;
      const s = g.current;

      const onDown = (e) => {
        st.setPointerCapture && st.setPointerCapture(e.pointerId);
        s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (s.pointers.size === 1) {
          s.downX = e.clientX; s.downY = e.clientY; s.downT = Date.now(); s.moved = 0;
          s.lastX = e.clientX; s.lastY = e.clientY;
        } else if (s.pointers.size === 2) {
          const p = Array.from(s.pointers.values());
          s.startDist = dist(p[0], p[1]);
          s.startScale = s.scale;
        }
      };

      const onMove = (e) => {
        if (!s.pointers.has(e.pointerId)) return;
        s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (s.pointers.size >= 2) {
          const p = Array.from(s.pointers.values());
          const d = dist(p[0], p[1]);
          if (s.startDist > 0) setZoom(s.startScale * (d / s.startDist));
        } else if (s.pointers.size === 1) {
          const dx = e.clientX - s.lastX, dy = e.clientY - s.lastY;
          s.lastX = e.clientX; s.lastY = e.clientY;
          s.moved += Math.abs(dx) + Math.abs(dy);
          if (s.scale > 1.02) { s.tx += dx; s.ty += dy; clampPan(); applyTransform(); }
        }
      };

      const onUp = (e) => {
        const wasPinch = s.pointers.size >= 2;
        s.pointers.delete(e.pointerId);
        st.releasePointerCapture && st.releasePointerCapture(e.pointerId);
        if (wasPinch) {
          s.lastPinchEnd = Date.now();
          if (s.scale <= 1.02) resetZoom();
          return;
        }
        if (s.pointers.size === 0) {
          const dt = Date.now() - s.downT;
          const recentlyPinched = Date.now() - s.lastPinchEnd < 200;
          // a clean tap only pages when at rest (not zoomed) and not a leftover pinch finger
          if (s.scale <= 1.02 && s.moved < 10 && dt < 300 && !recentlyPinched) {
            handleTap(e.clientX);
          }
          if (s.scale <= 1.02) resetZoom();
        }
      };

      const onWheel = (e) => {
        e.preventDefault();
        setZoom(s.scale * (e.deltaY < 0 ? 1.12 : 0.89));
      };

      st.addEventListener("pointerdown", onDown);
      st.addEventListener("pointermove", onMove);
      st.addEventListener("pointerup", onUp);
      st.addEventListener("pointercancel", onUp);
      st.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        st.removeEventListener("pointerdown", onDown);
        st.removeEventListener("pointermove", onMove);
        st.removeEventListener("pointerup", onUp);
        st.removeEventListener("pointercancel", onUp);
        st.removeEventListener("wheel", onWheel);
      };
    }, [applyTransform, clampPan, resetZoom, setZoom, handleTap]);

    // keyboard (desktop)
    useEffect(() => {
      const onKey = (e) => {
        const rtl = prefsRef.current.rtl;
        switch (e.key) {
          case "ArrowRight": rtl ? navRef.current.prev() : navRef.current.next(); break;
          case "ArrowLeft": rtl ? navRef.current.next() : navRef.current.prev(); break;
          case " ": case "PageDown": navRef.current.next(); e.preventDefault(); break;
          case "PageUp": navRef.current.prev(); break;
          case "Escape": navRef.current.exit(); break;
          case "h": case "H": navRef.current.toggleChrome(); break;
          case "0": resetZoom(); break;
          default: return;
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [resetZoom]);

    // ---- prefs toggles ------------------------------------------------------
    const patchPrefs = useCallback((patch) => {
      setPrefs((p) => { const np = Object.assign({}, p, patch); savePrefs(np); return np; });
    }, []);

    // ---- render -------------------------------------------------------------
    if (state.loading) {
      return h("div", { className: "gnr-root gnr-center" }, h("div", { className: "gnr-spinner" }), h("p", null, "Loading…"));
    }
    if (state.error) {
      return h("div", { className: "gnr-root gnr-center" },
        h("p", { className: "gnr-error" }, "Could not load gallery: " + state.error),
        h("button", { className: "gnr-btn", onClick: () => navRef.current.exit() }, "Back to gallery"));
    }
    if (total === 0) {
      return h("div", { className: "gnr-root gnr-center" },
        h("p", null, "This gallery has no images."),
        h("button", { className: "gnr-btn", onClick: () => navRef.current.exit() }, "Back to gallery"));
    }

    const current = state.images[page];
    const src = current && current.paths && current.paths.image;
    const slideClass = prefs.animations ? (dir === "next" ? "gnr-in-next" : "gnr-in-prev") : "";

    return h("div", { className: "gnr-root" + (zoomed ? " gnr-zoomed" : "") },
      h("div", {
        className: "gnr-stage",
        ref: stageRef,
        style: { touchAction: "none" },
      },
        h("div", { className: "gnr-slide " + slideClass, key: page },
          h("img", {
            className: "gnr-page",
            ref: imgRef,
            src: src,
            alt: "Page " + (page + 1),
            draggable: false,
          })
        )
      ),

      // top chrome
      chrome && h("div", { className: "gnr-bar gnr-top" },
        h("button", { className: "gnr-iconbtn", title: "Back (Esc)", onClick: () => navRef.current.exit() }, "✕"),
        h("span", { className: "gnr-title", title: state.title }, state.title),
        h("span", { className: "gnr-count" }, (page + 1) + " / " + total),
        h("button", {
          className: "gnr-iconbtn" + (prefs.rtl ? " gnr-on" : ""),
          title: "Reading direction: " + (prefs.rtl ? "right to left" : "left to right"),
          onClick: () => patchPrefs({ rtl: !prefs.rtl }),
        }, prefs.rtl ? "← RTL" : "LTR →"),
        h("button", {
          className: "gnr-iconbtn" + (prefs.animations ? " gnr-on" : ""),
          title: "Page-turn animation: " + (prefs.animations ? "on" : "off"),
          onClick: () => patchPrefs({ animations: !prefs.animations }),
        }, prefs.animations ? "Anim ●" : "Anim ○")
      ),

      // bottom chrome: scrubber
      chrome && h("div", { className: "gnr-bar gnr-bottom" },
        h("input", {
          className: "gnr-range",
          type: "range",
          min: 1, max: total, value: page + 1,
          onChange: (e) => goTo(parseInt(e.target.value, 10) - 1),
        })
      )
    );
  }

  // ---- register the route ----------------------------------------------------
  if (PluginApi.register && typeof PluginApi.register.route === "function") {
    PluginApi.register.route(ROUTE, GraphicNovelReader);
  } else {
    console.error("[GNR] PluginApi.register.route unavailable; cannot mount reader.");
  }

  // expose path helper for the integration buttons
  window.GNR = window.GNR || {};
  window.GNR.readerPath = (id) => `/plugins/graphic-novel-reader/${id}`;
  window.GNR.PLUGIN_ID = PLUGIN_ID;
})();
