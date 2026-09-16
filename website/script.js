// Gramiqo site: alive but respectful (reduced-motion aware).
(function () {
  "use strict";
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // FAQ accordion
  document.querySelectorAll(".faq .q").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ans = btn.nextElementSibling;
      const open = ans.classList.contains("open");
      document.querySelectorAll(".faq .a.open").forEach((a) => a.classList.remove("open"));
      document.querySelectorAll(".faq .q span").forEach((s) => (s.textContent = "+"));
      if (!open) {
        ans.classList.add("open");
        btn.querySelector("span").textContent = "–";
      }
    });
  });

  // smooth anchor scroll (respects reduced motion)
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const el = document.querySelector(a.getAttribute("href"));
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  });

  // mobile menu
  const menuBtn = document.getElementById("menuBtn");
  const panel = document.getElementById("mobilePanel");
  menuBtn?.addEventListener("click", () => {
    const open = panel?.hidden;
    if (panel) panel.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(!!open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  panel?.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      panel.hidden = true;
      menuBtn?.setAttribute("aria-expanded", "false");
    });
  });

  // copyright year (checklist: never ship a stale year)
  const yr = document.getElementById("yr");
  if (yr) yr.textContent = String(new Date().getFullYear());

  // nav shadow on scroll
  const nav = document.getElementById("topnav");
  const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 12);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // back to top
  const top = document.getElementById("toTop");
  window.addEventListener("scroll", () => top?.classList.toggle("show", window.scrollY > 700), { passive: true });
  top?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }));

  // scroll reveal
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  // animated counters
  const cio = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      cio.unobserve(en.target);
      const end = Number(en.target.dataset.count) || 0;
      if (reduced || !end) {
        en.target.textContent = String(end);
        return;
      }
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 1100);
        en.target.textContent = String(Math.round(end * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll(".count").forEach((el) => cio.observe(el));

  // feature marquee (built from card titles when present — homepage fallback otherwise)
  const track = document.getElementById("marqueeTrack");
  if (track) {
    let names = [...document.querySelectorAll("#featureGrid .card b")]
      .map((b) => b.textContent.trim()).filter(Boolean);
    if (!names.length) {
      names = ["Meta AI search", "Reels + video downloads", "Story saver", "HD profile pics", "Notes editor", "Reels toolkit", "Bulk saver", "Command palette", "Bio-links editor", "Growth tracker"];
    }
    const html = names.map((n) => `<span>${n.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`).join("");
    track.innerHTML = html + html; // loop seam
    if (!reduced) {
      let x = 0;
      let running = true;
      new IntersectionObserver((es) => {
        running = es[0]?.isIntersecting !== false;
      }).observe(track);
      const half = () => track.scrollWidth / 2 || 1;
      (function slide() {
        if (running && !document.hidden) {
          x -= 0.6;
          if (-x >= half()) x = 0;
          track.style.transform = `translateX(${x}px)`;
        }
        requestAnimationFrame(slide);
      })();
    }
  }

  // card narration demo bar
  const demoText = document.getElementById("demoText");
  document.querySelectorAll("#featureGrid .card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll("#featureGrid .card.picked").forEach((c) => c.classList.remove("picked"));
      card.classList.add("picked");
      if (demoText) demoText.textContent = card.dataset.demo || "One of 18 power features.";
    });
  });

  // hero typing demo: the mock search thinks for you
  const q = document.getElementById("typedQuery");
  const b = document.getElementById("typedBody");
  const samples = [
    ["travel", "8 accounts, 8 tags and 6 top reels…"],
    ["lofi beats", "5 accounts, 6 tags and 6 top reels…"],
    ["street food", "11 accounts, 9 tags and 6 top reels…"],
  ];
  if (q && b && !reduced) {
    let si = 0;
    const type = (text, el, done) => {
      let i = 0;
      el.textContent = "";
      const tick = () => {
        el.textContent = text.slice(0, ++i);
        if (i < text.length) setTimeout(tick, 55);
        else setTimeout(done, 2600);
      };
      tick();
    };
    const cycle = () => {
      const [word, body] = samples[si % samples.length];
      si += 1;
      b.textContent = "thinking…";
      type(word, q, () => {
        b.textContent = body;
        setTimeout(cycle, 500);
      });
    };
    setTimeout(cycle, 1800);
  }

  // gentle 3D tilt on the mock
  const mock = document.getElementById("mockTilt");
  if (mock && !reduced && window.matchMedia?.("(pointer: fine)").matches) {
    const hero = mock.closest(".hero");
    hero?.addEventListener("mousemove", (e) => {
      const r = mock.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      mock.style.transform = `perspective(900px) rotateY(${dx * 7}deg) rotateX(${-dy * 7}deg)`;
    });
    hero?.addEventListener("mouseleave", () => {
      mock.style.transform = "perspective(900px)";
    });
  }
})();
