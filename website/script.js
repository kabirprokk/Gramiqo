// website micro-interactions: FAQ accordion + copy helper
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

document.getElementById("copyPath")?.addEventListener("click", async () => {
  const t = "inta-enhancer";
  try {
    await navigator.clipboard.writeText(t);
    const b = document.getElementById("copyPath");
    b.textContent = "Copied!";
    setTimeout(() => (b.textContent = "Copy folder name"), 1800);
  } catch {
    alert(t);
  }
});

// smooth anchor scroll (respects reduced motion)
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
