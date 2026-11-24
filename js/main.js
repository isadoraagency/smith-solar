/* ==========================================================================
   Smith Solar — motion
   GSAP 3 (ScrollTrigger + SplitText) and Lenis smooth scroll.
   Sections are set up in page order so pinned sections calculate correctly.
   ========================================================================== */
(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DESKTOP = "(min-width: 901px)";
  const MOBILE = "(max-width: 900px)";

  gsap.registerPlugin(ScrollTrigger, SplitText);
  ScrollTrigger.config({ ignoreMobileResize: true });
  gsap.defaults({ ease: "expo.out", duration: 1.1 });

  const nav = $("[data-nav]");
  // nav items that animate in after the loader (the logo never moves)
  const NAV_INTRO = ".nav__switch, .nav__links, .nav__cta, .nav__menu";
  const INTRO_HIDDEN = `${NAV_INTRO}, .hero__title, .hero__pill, .hero__aside > *, .hero__scroll > *, .hero__outro`;
  let lenis = null;

  /* ------------------------------------------------------------------------
     Smooth scroll
     ------------------------------------------------------------------------ */
  function initLenis() {
    if (REDUCED || typeof Lenis === "undefined") return;
    lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.15,
    });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }

  function initAnchors() {
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href");
      e.preventDefault();
      if (id.length < 2) return;
      const target = $(id);
      if (!target) return;
      closeMenu();
      if (lenis)
        lenis.scrollTo(target, {
          duration: 1.8,
          easing: (t) => 1 - Math.pow(1 - t, 4),
        });
      else target.scrollIntoView();
    });
  }

  /* ------------------------------------------------------------------------
     Mobile menu
     ------------------------------------------------------------------------ */
  const menuBtn = $(".nav__menu");
  const menu = $("#mobile-menu");
  let menuOpen = false;

  function openMenu() {
    menuOpen = true;
    menu.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    nav.classList.add("menu-open");
    lenis && lenis.stop();
    gsap.fromTo(
      menu,
      { clipPath: "inset(0 0 100% 0)" },
      { clipPath: "inset(0 0 0% 0)", duration: 0.9, ease: "expo.inOut" },
    );
    gsap.fromTo(
      menu.children,
      { yPercent: 60, autoAlpha: 0 },
      { yPercent: 0, autoAlpha: 1, stagger: 0.06, delay: 0.35 },
    );
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menuBtn.setAttribute("aria-expanded", "false");
    nav.classList.remove("menu-open");
    lenis && lenis.start();
    gsap.to(menu, {
      clipPath: "inset(0 0 100% 0)",
      duration: 0.7,
      ease: "expo.inOut",
      onComplete: () => (menu.hidden = true),
    });
  }
  menuBtn.addEventListener("click", () =>
    menuOpen ? closeMenu() : openMenu(),
  );
  document.addEventListener(
    "keydown",
    (e) => e.key === "Escape" && closeMenu(),
  );

  /* ------------------------------------------------------------------------
     Video loader — fetch fully into a Blob so scrubbing never stalls.
     Falls back to streaming src if fetch fails or is slow.
     ------------------------------------------------------------------------ */
  function loadVideo(video, onProgress) {
    const src = video.dataset.src;
    const ctrl = "AbortController" in window ? new AbortController() : null;

    const viaFetch = (async () => {
      const res = await fetch(src, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok || !res.body) throw new Error("fetch failed");
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (total) onProgress(got / total);
      }
      return URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
    })();

    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("timeout")), 9000),
    );

    return Promise.race([viaFetch, timeout])
      .catch(() => {
        ctrl && ctrl.abort();
        return src;
      })
      .then(
        (url) =>
          new Promise((resolve) => {
            const done = () => resolve();
            video.addEventListener("loadeddata", done, { once: true });
            video.addEventListener("error", done, { once: true });
            video.src = url;
            video.load();
            setTimeout(done, 4000);
          }),
      )
      .then(() => {
        // Prime decoding on iOS so seeks paint frames
        const p = video.play();
        if (p && p.then) p.then(() => video.pause()).catch(() => {});
        else video.pause();
      });
  }

  /* ------------------------------------------------------------------------
     Preloader
     A yellow veil with a panel-shaped (parallelogram) window. A faint outline
     fills with white from the bottom up as the video loads; once loaded the window opens onto the
     hero and grows until it covers the screen. The logo is pinned to the
     nav logo's exact position so it never moves.
     ------------------------------------------------------------------------ */
  const FIXED = (n) => n.toFixed(1);
  const toward = (P, Q, r) => {
    const dx = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dx, dy) || 1;
    return [P[0] + (dx / L) * r, P[1] + (dy / L) * r];
  };

  function runLoader(video) {
    const loader = $(".loader");
    const svg = $("[data-loader-svg]");
    const veil = $("[data-veil]");
    const fill = $("[data-fill]");
    const track = $("[data-track-path]");
    const halves = $$("[data-half]");
    const logo = $("[data-loader-logo]");
    const countEl = $(".js-load-count");
    const facts = $$("[data-facts] p");
    const shape = { s: 1, draw: 0 }; // size stays fixed while loading
    let W = 0, H = 0, base = null;

    const measure = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const h = Math.min(H * 0.34, W * 0.44, 320);
      base = { h, w: h * 0.86, off: h * 0.52, r: Math.max(6, h * 0.04) };
      const r = $(".nav__brand .logo").getBoundingClientRect();
      logo.style.left = r.left + "px";
      logo.style.top = r.top + "px";
    };

    // Rounded parallelogram centred on screen, scaled by s
    const geom = (s) => {
      const h = base.h * s, w = base.w * s, off = base.off * s;
      const r = Math.min(base.r * s, h * 0.2);
      const cx = W / 2, cy = H / 2;
      const TR = [cx + (w + off) / 2, cy - h / 2];
      const TL = [TR[0] - w, TR[1]];
      const BL = [cx - (w + off) / 2, cy + h / 2];
      const BR = [BL[0] + w, BL[1]];
      const TC = [(TL[0] + TR[0]) / 2, TL[1]];
      const BC = [(BL[0] + BR[0]) / 2, BL[1]];
      return { TL, TR, BR, BL, TC, BC, r };
    };
    const pt = (P) => `${FIXED(P[0])} ${FIXED(P[1])}`;
    // rounded corner at P, coming from A and leaving towards B
    const corner = (P, A, B, r) => `L${pt(toward(P, A, r))}Q${pt(P)} ${pt(toward(P, B, r))}`;

    const draw = () => {
      const { TL, TR, BR, BL, TC, BC, r } = geom(shape.s);
      const closed = `M${pt(TC)}${corner(TR, TL, BR, r)}${corner(BR, TR, BL, r)}${corner(BL, BR, TL, r)}${corner(TL, BL, TR, r)}Z`;
      // two halves from bottom-centre, up each side, meeting at top-centre
      const left = `M${pt(BC)}${corner(BL, BR, TL, r)}${corner(TL, BL, TR, r)}L${pt(TC)}`;
      const right = `M${pt(BC)}${corner(BR, BL, TR, r)}${corner(TR, BR, TL, r)}L${pt(TC)}`;
      veil.setAttribute("d", `M-2 -2H${W + 2}V${H + 2}H-2Z${closed}`);
      fill.setAttribute("d", closed);
      track.setAttribute("d", closed);
      halves[0].setAttribute("d", left);
      halves[1].setAttribute("d", right);
      halves.forEach((h) => (h.style.strokeDashoffset = 1 - shape.draw));
    };
    const onResize = () => { measure(); draw(); };

    measure();
    draw();
    loader.classList.add("is-drawn");
    window.addEventListener("resize", onResize);

    // Progress → counter + outline
    const shown = { v: 0 };
    let real = 0;
    const render = () => {
      const p = shown.v / 100;
      countEl.textContent = Math.round(shown.v);
      shape.draw = p;
      draw();
    };
    const creep = gsap.to(shown, { v: 88, duration: 6, ease: "power1.out", onUpdate: render });
    const follow = (p) => {
      real = Math.max(real, p * 100);
      if (real > shown.v) {
        creep.kill();
        gsap.to(shown, { v: Math.min(real, 99), duration: 0.5, ease: "power2.out", onUpdate: render, overwrite: true });
      }
    };

    // Rotating facts (three, looping while loading takes a while)
    let fi = 0;
    const showFact = (el, delay = 0) =>
      gsap.fromTo(el, { autoAlpha: 0, yPercent: 60 }, { autoAlpha: 1, yPercent: 0, duration: 0.9, delay, ease: "expo.out" });
    showFact(facts[0], 0.3);
    const factTimer = setInterval(() => {
      const cur = facts[fi];
      fi = (fi + 1) % facts.length;
      gsap.to(cur, { autoAlpha: 0, yPercent: -60, duration: 0.55, ease: "power2.in" });
      showFact(facts[fi], 0.4);
    }, 2800);

    gsap.from(".loader__count", { yPercent: 40, autoAlpha: 0, duration: 1, ease: "expo.out", delay: 0.1 });

    const minTime = new Promise((r) => setTimeout(r, 1800));
    return Promise.all([loadVideo(video, follow), document.fonts ? document.fonts.ready : null, minTime]).then(
      () =>
        new Promise((resolve) => {
          creep.kill();
          gsap.to(shown, {
            v: 100,
            duration: 0.7,
            ease: "power2.out",
            overwrite: true,
            onUpdate: render,
            onComplete: () => {
              clearInterval(factTimer);
              const k = base.off / base.h;
              const cover = Math.max(H / base.h, (W + k * H) / base.w) * 1.15;

              gsap
                .timeline({
                  delay: 0.15,
                  onComplete: () => {
                    window.removeEventListener("resize", onResize);
                    loader.remove();
                  },
                })
                // 1. the filled shape turns hollow: a window onto the hero video
                .to(fill, { opacity: 0, duration: 0.8, ease: "power2.inOut" }, 0)
                .fromTo(".hero__video", { scale: 1.35 }, { scale: 1.06, duration: 2.6, ease: "expo.inOut", clearProps: "transform" }, 0)
                .to(".loader__facts, .loader__count", { y: 24, autoAlpha: 0, duration: 0.6, ease: "power2.in" }, 0.1)
                // 2. it grows until it fills the screen
                .to(shape, { s: cover, duration: 1.7, ease: "expo.inOut", onUpdate: draw }, 0.55)
                .to(logo, { color: "#ffffff", duration: 0.7, ease: "power1.inOut" }, 1.05)
                .to([track, ...halves], { opacity: 0, duration: 0.5, ease: "power1.in" }, 1.55)
                .add(resolve, 1.35);
            },
          });
        }),
    );
  }

  /* ------------------------------------------------------------------------
     Indent follow — the tab cut-outs drift lazily after the cursor along
     their edge (x for sourcing, y for stats).
     ------------------------------------------------------------------------ */
  function notchFollow(section, el, axis, range) {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const to = gsap.quickTo(el, axis, { duration: 2.4, ease: "power3.out" });
    section.addEventListener("pointermove", (e) => {
      const r = section.getBoundingClientRect();
      const n = axis === "x" ? (e.clientX - r.left) / r.width - 0.5 : (e.clientY - r.top) / r.height - 0.5;
      to(Math.max(-1, Math.min(1, n * 2)) * range());
    });
    section.addEventListener("pointerleave", () => to(0));
  }

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  // Line-masked reveal that re-splits on resize and keeps its progress.
  function revealLines(el, opts = {}) {
    SplitText.create(el, {
      type: "lines",
      mask: "lines",
      linesClass: "split-line",
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 105,
          duration: opts.duration || 1.2,
          stagger: opts.stagger || 0.09,
          ease: "expo.out",
          scrollTrigger: {
            trigger: opts.trigger || el,
            start: opts.start || "top 82%",
            toggleActions: "play none none reverse",
          },
        }),
    });
  }

  /* ------------------------------------------------------------------------
     Intro (after loader)
     ------------------------------------------------------------------------ */
  function playIntro(titleWords) {
    const tl = gsap.timeline({ defaults: { ease: "expo.out", duration: 1.4 } });
    tl.from(titleWords, { yPercent: 110, stagger: 0.06 }, 0)
      .from(
        ".hero__pill",
        { clipPath: "inset(0 100% 0 0 round 999px)", duration: 1.2 },
        0.45,
      )
      .from(
        ".hero__lede, .hero__ctas > *",
        { y: 28, autoAlpha: 0, stagger: 0.08 },
        0.55,
      )
      .from(".hero__scroll > *", { y: 14, autoAlpha: 0, stagger: 0.08 }, 0.8)
      .from(
        NAV_INTRO,
        { y: -24, autoAlpha: 0, stagger: 0.07, duration: 1.2, clearProps: "transform,opacity,visibility" },
        0.2,
      );
    return tl;
  }

  /* ------------------------------------------------------------------------
     1 + 2 — Hero: one pinned stage, video scrubbed by scroll
     ------------------------------------------------------------------------ */
  function initHero(video) {
    const hero = $("[data-hero]");
    const outroSplit = SplitText.create("[data-outro-title]", {
      type: "words",
      mask: "words",
    });

    // Smoothly chase the scroll-driven target time
    const v = { target: 0, current: 0 };
    gsap.ticker.add(() => {
      const d = video.duration;
      if (!d || !isFinite(d)) return;
      v.current += (v.target - v.current) * 0.2;
      const t = v.current * (d - 0.05);
      if (!video.seeking && Math.abs(video.currentTime - t) > 0.01)
        video.currentTime = t;
    });

    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: () => "+=" + window.innerHeight * 3,
        pin: true,
        scrub: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        refreshPriority: 30,
      },
    });

    // Video plays 0 → end over the first 82%, then holds
    tl.to(v, { target: 1, duration: 0.82 }, 0)
      .fromTo(
        ".hero__media",
        { scale: 1, yPercent: 0 },
        { scale: 1.06, yPercent: -2, duration: 1 },
        0,
      )
      .to(".hero__progress span", { scaleX: 1, duration: 1 }, 0)

      // Section 1 out (staggered parallax)
      .to(".hero__scroll", { autoAlpha: 0, y: -20, duration: 0.08 }, 0)
      .to(
        ".hero__title",
        {
          y: () => -window.innerHeight * 0.22,
          autoAlpha: 0,
          duration: 0.24,
          ease: "power1.in",
        },
        0.03,
      )
      .to(
        ".hero__pill",
        {
          y: () => -window.innerHeight * 0.18,
          autoAlpha: 0,
          duration: 0.22,
          ease: "power1.in",
        },
        0.05,
      )
      .to(
        ".hero__aside",
        {
          y: () => -window.innerHeight * 0.3,
          autoAlpha: 0,
          duration: 0.24,
          ease: "power1.in",
        },
        0.02,
      )

      // Section 2 in, as the video comes to rest
      .fromTo(
        outroSplit.words,
        { yPercent: 110 },
        { yPercent: 0, stagger: 0.012, duration: 0.14, ease: "power3.out" },
        0.56,
      )
      .fromTo(
        "[data-outro-btn]",
        { y: 30, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.1, ease: "power2.out" },
        0.72,
      )
      .to({}, { duration: 0.0001 }, 1);

    // Nav turns white once the video section has passed
    ScrollTrigger.create({
      trigger: "[data-statement]",
      start: () =>
        "top " + (nav.offsetHeight + parseFloat(getComputedStyle(nav).top)),
      onEnter: () => nav.classList.add("is-light"),
      onLeaveBack: () => nav.classList.remove("is-light"),
    });
  }

  /* ------------------------------------------------------------------------
     3 — Statement: text reveal, then pinned card stack with 3D flip
     ------------------------------------------------------------------------ */
  function initStatement() {
    const section = $("[data-statement]");
    const text = $("[data-statement-text]");
    const track = $("[data-track]");
    const cards = $$("[data-card]", track);
    const btn = $("[data-track-btn]");

    // Quick word reveal as the section arrives
    const split = SplitText.create(text, { type: "words", mask: "words" });
    gsap.from(split.words, {
      yPercent: 110,
      duration: 0.9,
      stagger: 0.012,
      ease: "expo.out",
      scrollTrigger: {
        trigger: section,
        start: "top 72%",
        toggleActions: "play none none reverse",
      },
    });

    // Geometry cache (offsetTop ignores transforms)
    let centers = [];
    let cardH = 0;
    const measure = () => {
      centers = cards.map((c) => c.offsetTop + c.offsetHeight / 2);
      cardH = cards[0].offsetHeight;
    };
    const travel = () => window.innerHeight / 2 + centers[centers.length - 1];

    const setters = cards.map((c) => ({
      rx: gsap.quickSetter(c, "rotationX", "deg"),
      rz: gsap.quickSetter(c, "rotationZ", "deg"),
      z: gsap.quickSetter(c, "z", "px"),
      s: gsap.quickSetter(c, "scale"),
      o: gsap.quickSetter(c, "opacity"),
    }));
    // each word gets its own fade window, staggered in reading order
    const wordO = split.words.map((w) => gsap.quickSetter(w, "opacity"));
    const FADE = 0.28; // share of the first card's rise that one word takes to fade
    const textS = gsap.quickSetter(text, "scale");
    const btnO = gsap.quickSetter(btn, "opacity");
    const btnY = gsap.quickSetter(btn, "y", "px");

    gsap.set(track, { xPercent: -50, y: 0 });
    gsap.set(cards, {
      transformPerspective: 1400,
      transformOrigin: "50% 100%",
    });

    const update = () => {
      const vh = window.innerHeight;
      const y = gsap.getProperty(track, "y");
      const span = vh / 2 + cardH / 2;
      cards.forEach((card, i) => {
        const center = vh + y + centers[i]; // card centre in stage (viewport) space
        const enter = clamp01((vh + cardH / 2 - center) / span); // 0 at bottom edge → 1 at centre
        const leave = clamp01((vh / 2 - center) / span); // 0 at centre → 1 at top edge
        const e = 1 - Math.pow(1 - enter, 3);
        const st = setters[i];
        st.rx(58 * (1 - e) - 10 * leave);
        st.rz(-5 * (1 - e) * (i % 2 ? -1 : 1));
        st.z(-220 * (1 - e) - 60 * leave);
        st.s(1 - 0.04 * leave);
        st.o(Math.min(1, enter * 1.8) * (1 - 0.25 * leave));
        card.style.setProperty("--dots", clamp01((enter - 0.75) / 0.25).toFixed(3));
      });
      // Heading recedes as the first card rises
      const first = clamp01((vh + cardH / 2 - (vh + y + centers[0])) / span);
      const last = wordO.length - 1 || 1;
      wordO.forEach((set, k) => {
        const t = clamp01((first - (k / last) * (1 - FADE)) / FADE);
        set(1 - t * t * (3 - 2 * t)); // smoothstep
      });
      textS(1 - 0.04 * first);
      // Button follows the last card in
      const lastCard = clamp01(
        (vh + cardH / 2 - (vh + y + centers[cards.length - 1])) / span,
      );
      btnO(clamp01((lastCard - 0.55) / 0.45));
      btnY(24 * (1 - lastCard));
    };

    ScrollTrigger.addEventListener("refreshInit", measure);
    measure();
    update();

    gsap
      .timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => "+=" + travel() * 1.12,
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          refreshPriority: 20,
        },
        onUpdate: update,
      })
      .to(track, { y: () => -travel(), duration: 1, ease: "none" })
      .to({}, { duration: 0.12 }); // brief hold with last card centred before unpinning
  }

  /* ------------------------------------------------------------------------
     4 — Sourcing: heading reveal, card rise, wireframe parallax
     ------------------------------------------------------------------------ */
  function initSourcing() {
    const section = $("[data-sourcing]");
    revealLines($(".sourcing__title"));

    // Tab cut-out (indent) — disabled with its markup; runs again if the markup returns
    const notchSvg = $("[data-notch]");
    if (notchSvg) {
      gsap.fromTo(
        notchSvg,
        { scaleX: 0.55, scaleY: 0.2 },
        {
          scaleX: 1,
          scaleY: 1,
          ease: "none",
          scrollTrigger: { trigger: section, start: "top bottom", end: "top 35%", scrub: true },
        },
      );
      notchFollow(section, ".sourcing__notch", "x", () =>
        Math.max(0, Math.min(section.offsetWidth * 0.12, (section.offsetWidth - notchSvg.getBoundingClientRect().width) / 2 - 60)),
      );
    }

    gsap.fromTo(
      "[data-wire]",
      { yPercent: -14, xPercent: 4, rotation: -2 },
      {
        yPercent: 16,
        xPercent: -3,
        rotation: 1,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      },
    );

    // entrance: the row fades in, each card rises (opacity stays free for the scrub below)
    gsap.from(".compare", {
      autoAlpha: 0,
      duration: 1,
      ease: "power2.out",
      scrollTrigger: { trigger: ".compare", start: "top 85%", toggleActions: "play none none reverse" },
    });
    gsap.from("[data-compare]", {
      y: 90,
      rotationX: 8,
      transformPerspective: 1600,
      transformOrigin: "50% 100%",
      duration: 1.4,
      stagger: 0.14,
      scrollTrigger: {
        trigger: ".compare",
        start: "top 85%",
        toggleActions: "play none none reverse",
      },
    });
    gsap.from(".sourcing .dots-col i", {
      scale: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: "back.out(3)",
      scrollTrigger: {
        trigger: ".compare",
        start: "top 80%",
        toggleActions: "play none none reverse",
      },
    });

    // Emphasis on "How we work": pin, slide the white card away and open the
    // blue card to full width, revealing the photo with a parallax drift.
    gsap.matchMedia().add(DESKTOP, () => {
      const white = $(".compare__card--light");
      const blue = $(".compare__card--blue");
      const body = $(".compare__body", blue);
      const media = $(".compare__media", blue);
      const img = $("[data-compare-img]");
      const midDots = $(".compare > .dots-col--mid");
      const endDots = $(".compare > .dots-col--end");
      const R = 22;
      // left edge of the blue card's starting slot (half the row + half the gutter)
      const startX = () => blue.offsetWidth / 2 + 19;

      gsap
        .timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: {
            trigger: section,
            start: () => (section.offsetHeight <= window.innerHeight ? "bottom bottom" : "top top"),
            end: () => "+=" + window.innerHeight * 0.85,
            pin: true,
            scrub: 0.8,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            refreshPriority: 15,
          },
        })
        .fromTo(
          blue,
          { clipPath: () => `inset(0px 0px 0px ${startX()}px round ${R}px)` },
          { clipPath: `inset(0px 0px 0px 0px round ${R}px)`, duration: 1 },
          0,
        )
        .fromTo(body, { x: startX }, { x: 0, duration: 1 }, 0)
        .fromTo(midDots, { x: 0 }, { x: () => -startX(), duration: 1 }, 0)
        .fromTo(
          white,
          { x: 0, scale: 1, opacity: 1, transformOrigin: "0% 50%" },
          { x: () => -white.offsetWidth * 0.45, scale: 0.84, opacity: 0, duration: 0.9 },
          0,
        )
        .fromTo(media, { clipPath: "inset(0% 0% 0% 100%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.85 }, 0.15)
        .fromTo(img, { xPercent: 22, scale: 1.2 }, { xPercent: 0, scale: 1.03, duration: 1, ease: "power1.out" }, 0)
        .fromTo(endDots, { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.2, ease: "power2.out" }, 0.8)
        .to({}, { duration: 0.15 }); // short hold on the final layout before unpinning
    });
  }

  /* ------------------------------------------------------------------------
     5 — Stats: headline reveal, then pinned squeeze + counters
     ------------------------------------------------------------------------ */
  function initStats() {
    const section = $("[data-stats]");
    const headline = $("[data-stats-headline]");
    const rows = $$("[data-stat]");
    const counters = $$("[data-count]");

    const split = SplitText.create(headline, { type: "words", mask: "words" });
    gsap.from(split.words, {
      yPercent: 110,
      duration: 1,
      stagger: 0.02,
      scrollTrigger: {
        trigger: section,
        start: "top 55%",
        toggleActions: "play none none reverse",
      },
    });
    gsap.fromTo(
      "[data-stats-img]",
      { yPercent: -8 },
      {
        yPercent: 0,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "top top",
          scrub: true,
        },
      },
    );

    const build = (isDesktop) => {
      const counts = counters.map(() => ({ v: 0 }));
      const writeCounts = () =>
        counters.forEach((el, i) => (el.textContent = Math.round(counts[i].v)));
      writeCounts();

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => "+=" + window.innerHeight * 1.6,
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          refreshPriority: 10,
        },
      });

      tl.to(
        headline,
        { autoAlpha: 0, y: -40, duration: 0.18, ease: "power1.in" },
        0.02,
      )
        .fromTo(
          "[data-stats-media]",
          isDesktop ? { "--cut": 0 } : { clipPath: "inset(0% 0% 0% 0%)" },
          isDesktop
            ? { "--cut": 55.2, duration: 0.6, ease: "power2.inOut" }
            : { clipPath: "inset(0% 0% 58% 0%)", duration: 0.6, ease: "power2.inOut" },
          0.06,
        )
        .fromTo(
          "[data-stats-img]",
          { scale: 1.12, x: 0 },
          {
            scale: 1,
            x: () => (isDesktop ? -window.innerWidth * 0.16 : 0),
            duration: 0.6,
            ease: "power2.inOut",
          },
          0.06,
        )
        .from(
          rows,
          {
            x: isDesktop ? 80 : 0,
            y: isDesktop ? 0 : 40,
            autoAlpha: 0,
            stagger: 0.06,
            duration: 0.3,
            ease: "power3.out",
          },
          0.38,
        )
        .from(
          ".stat__rule",
          { scaleX: 0, stagger: 0.06, duration: 0.32, ease: "power2.out" },
          0.42,
        );

      // the tab grows out of the image edge as the squeeze settles
      if (isDesktop && $("[data-stats-notch] svg")) {
        tl.fromTo("[data-stats-notch] svg", { scaleX: 0 }, { scaleX: 1, duration: 0.24, ease: "power2.out" }, 0.48);
      }

      counts.forEach((c, i) => {
        tl.to(
          c,
          {
            v: Number(counters[i].dataset.count),
            duration: 0.34,
            ease: "power2.out",
            onUpdate: writeCounts,
          },
          0.4 + i * 0.06,
        );
      });
      tl.to({}, { duration: 0.12 });
    };

    // indent disabled with its markup; runs again if the markup returns
    const notchSvg = $("[data-stats-notch] svg");
    if (notchSvg) {
      notchFollow(section, "[data-stats-notch]", "y", () =>
        Math.max(0, ((section.offsetHeight - notchSvg.getBoundingClientRect().height) / 2 - 70) * 0.45),
      );
    }

    gsap.matchMedia().add({ desktop: DESKTOP, mobile: MOBILE }, (ctx) => {
      build(ctx.conditions.desktop);
      return () =>
        counters.forEach((el) => (el.textContent = el.dataset.count));
    });
  }

  /* ------------------------------------------------------------------------
     6 — Categories: hover/focus/tap swaps image
     ------------------------------------------------------------------------ */
  function initCategories() {
    const section = $("[data-cats]");
    const items = $$("[data-cat]");
    const layers = $$("[data-cat-layer]");
    const dot = $("[data-cat-dot]");
    const line = $("[data-cat-line]");
    const path = line.querySelector("path");
    let active = -1;

    const pathLen = path.getTotalLength();
    gsap.set(path, { strokeDasharray: pathLen, strokeDashoffset: pathLen });

    const place = (i, instant) => {
      const btn = items[i];
      const li = btn.parentElement;
      const dotY = li.offsetTop + btn.offsetHeight / 2 - dot.offsetHeight / 2;
      const lineY = li.offsetTop + btn.offsetHeight + 8;
      gsap.to(dot, { y: dotY, duration: instant ? 0 : 0.8, ease: "expo.out" });
      gsap.set(line, { y: lineY });
      gsap.fromTo(
        path,
        { strokeDashoffset: pathLen },
        {
          strokeDashoffset: 0,
          duration: instant ? 0 : 1.1,
          ease: "expo.out",
          delay: instant ? 0 : 0.12,
        },
      );
    };

    const setActive = (i, instant = false) => {
      if (i === active) return;
      const prev = layers[active];
      active = i;
      items.forEach((b, k) => {
        b.classList.toggle("is-active", k === i);
        b.classList.toggle("is-after", k > i);
        b.setAttribute("aria-pressed", k === i ? "true" : "false");
      });
      const next = layers[i];
      gsap.killTweensOf(next);
      layers.forEach(
        (l) => (l.style.zIndex = l === next ? 2 : l === prev ? 1 : 0),
      );
      if (instant || REDUCED) {
        layers.forEach((l) =>
          gsap.set(l, { opacity: l === next ? 1 : 0, scale: 1 }),
        );
      } else {
        gsap.fromTo(
          next,
          { opacity: 0, scale: 1.1 },
          {
            opacity: 1,
            scale: 1,
            duration: 1.3,
            ease: "expo.out",
            onComplete: () =>
              layers.forEach((l) => l !== next && gsap.set(l, { opacity: 0 })),
          },
        );
        prev && gsap.to(prev, { scale: 1.04, duration: 1.3, ease: "expo.out" });
      }
      // CSS shifts later items down; wait a frame so measurements include it
      requestAnimationFrame(() => place(i, instant));
    };

    items.forEach((b, i) => {
      b.addEventListener("mouseenter", () => setActive(i));
      b.addEventListener("focus", () => setActive(i));
      b.addEventListener("click", () => setActive(i));
    });
    setActive(0, true);
    window.addEventListener("resize", () => place(active, true));

    // Touch devices: gentle auto-cycle while in view
    if (window.matchMedia("(hover: none)").matches && !REDUCED) {
      let timer = null;
      const start = () => {
        stop();
        timer = setInterval(() => setActive((active + 1) % items.length), 3200);
      };
      const stop = () => timer && clearInterval(timer);
      ScrollTrigger.create({
        trigger: section,
        start: "top 60%",
        end: "bottom 40%",
        onToggle: (s) => (s.isActive ? start() : stop()),
      });
      items.forEach((b) => b.addEventListener("click", start));
    }

    // Parallax + entrance
    gsap.fromTo(
      "[data-cats-media]",
      { yPercent: -5 },
      {
        yPercent: 5,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      },
    );
    // animate the <li>s: the buttons carry CSS transitions that would fight GSAP
    gsap.from(
      items.map((b) => b.parentElement),
      {
        y: 16,
        autoAlpha: 0,
        stagger: 0.06,
        duration: 1,
        scrollTrigger: {
          trigger: section,
          start: "top 60%",
          toggleActions: "play none none reverse",
        },
      },
    );
    gsap.from(dot, {
      scale: 0,
      duration: 0.8,
      delay: 0.5,
      ease: "back.out(3)",
      scrollTrigger: {
        trigger: section,
        start: "top 60%",
        toggleActions: "play none none reverse",
      },
    });
    revealLines($(".cats__foot h2"), { start: "top 88%" });
    gsap.from(".cats__foot .btn", {
      y: 24,
      autoAlpha: 0,
      duration: 1.1,
      scrollTrigger: {
        trigger: ".cats__foot",
        start: "top 90%",
        toggleActions: "play none none reverse",
      },
    });
  }

  /* ------------------------------------------------------------------------
     Pre-footer — same subtle 3D flip, scrubbed
     ------------------------------------------------------------------------ */
  function initPrefooter() {
    const cards = $$("[data-flip]");
    gsap.set(cards, {
      transformPerspective: 1600,
      transformOrigin: "50% 100%",
    });
    cards.forEach((card, i) => {
      gsap.fromTo(
        card,
        { rotationX: 34, rotationZ: i ? 3 : -3, z: -180, y: 110, opacity: 0 },
        {
          rotationX: 0,
          rotationZ: 0,
          z: 0,
          y: 0,
          opacity: 1,
          ease: "power2.out",
          scrollTrigger: {
            trigger: card,
            start: "top 102%",
            end: `top ${58 - i * 6}%`,
            scrub: 0.8,
          },
        },
      );
    });
    gsap.from(".prefoot .dots-col i", {
      scale: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: "back.out(3)",
      scrollTrigger: {
        trigger: ".prefoot",
        start: "top 70%",
        toggleActions: "play none none reverse",
      },
    });
  }

  /* ------------------------------------------------------------------------
     Footer — subtle curtain parallax + staggered reveals
     ------------------------------------------------------------------------ */
  function initFooter() {
    const footer = $("[data-footer]");
    gsap.fromTo(
      ".footer__inner",
      { yPercent: -14 },
      {
        yPercent: 0,
        ease: "none",
        scrollTrigger: {
          trigger: footer,
          start: "top bottom",
          end: "top 25%",
          scrub: true,
        },
      },
    );
    gsap.fromTo(
      footer,
      { "--bgy": "-60px" },
      {
        "--bgy": "0px",
        ease: "none",
        scrollTrigger: {
          trigger: footer,
          start: "top bottom",
          end: "bottom bottom",
          scrub: true,
        },
      },
    );
    revealLines($(".footer__top h2"), { start: "top 85%" });

    // Grid lights up softly around the cursor and trails after it
    const glow = $("[data-foot-glow]");
    if (glow && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const toX = gsap.quickTo(glow, "--mx", { duration: 0.9, ease: "power3.out" });
      const toY = gsap.quickTo(glow, "--my", { duration: 0.9, ease: "power3.out" });
      const local = (e) => {
        const r = footer.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      footer.addEventListener("pointerenter", (e) => {
        const [x, y] = local(e);
        toX(x, x);
        toY(y, y);
        gsap.to(glow, { opacity: 0.75, duration: 0.8, ease: "power2.out", overwrite: "auto" });
      });
      footer.addEventListener("pointermove", (e) => {
        const [x, y] = local(e);
        toX(x);
        toY(y);
      });
      footer.addEventListener("pointerleave", () =>
        gsap.to(glow, { opacity: 0, duration: 1, ease: "power2.out", overwrite: "auto" }),
      );
    }

    const st = {
      trigger: footer,
      start: "top 65%",
      toggleActions: "play none none reverse",
    };
    gsap.from("[data-foot-rule]", {
      scaleX: 0,
      duration: 1.6,
      ease: "expo.inOut",
      scrollTrigger: st,
    });
    gsap.from("[data-foot-fade]", {
      y: 36,
      autoAlpha: 0,
      stagger: 0.08,
      duration: 1.2,
      delay: 0.15,
      scrollTrigger: st,
    });
    gsap.from(".footer__social li", {
      scale: 0.4,
      autoAlpha: 0,
      stagger: 0.05,
      duration: 0.9,
      delay: 0.45,
      ease: "back.out(2.2)",
      scrollTrigger: st,
    });
  }

  /* ------------------------------------------------------------------------
     Reduced motion — static, readable layout
     ------------------------------------------------------------------------ */
  function initStatic(video) {
    document.documentElement.classList.add("is-static");
    $(".loader") && $(".loader").remove();
    document.body.classList.remove("is-loading");
    video.removeAttribute("data-src");
    ScrollTrigger.create({
      trigger: "[data-statement]",
      start: "top 90px",
      onEnter: () => nav.classList.add("is-light"),
      onLeaveBack: () => nav.classList.remove("is-light"),
    });
    initCategories();
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  initAnchors();
  const video = $(".hero__video");

  if (REDUCED) {
    initStatic(video);
    return;
  }

  initLenis();
  window.scrollTo(0, 0);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // Hide intro elements before the loader lifts
  gsap.set(INTRO_HIDDEN, { autoAlpha: 0 });

  // The loader markup is commented out in index.html. Without it, start straight
  // away: the video downloads in the background and the hero eases in.
  const start = $(".loader")
    ? runLoader(video)
    : (() => {
        loadVideo(video, () => {});
        return (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
          gsap.fromTo(".hero__video", { scale: 1.25 }, { scale: 1.06, duration: 2.4, ease: "expo.out", clearProps: "transform" });
        });
      })();

  start.then(() => {
    document.body.classList.remove("is-loading");
    gsap.set(INTRO_HIDDEN, {
      clearProps: "opacity,visibility",
    });

    const titleSplit = SplitText.create(".hero__title", {
      type: "words",
      mask: "words",
    });

    // Order matters: pinned sections top → bottom
    initHero(video);
    initStatement();
    initSourcing();
    initStats();
    initCategories();
    initPrefooter();
    initFooter();

    playIntro(titleSplit.words);
    ScrollTrigger.refresh();
    lenis && lenis.start();
  });
})();
