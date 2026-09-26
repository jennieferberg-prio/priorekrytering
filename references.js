(function () {
  "use strict";

  document.querySelectorAll("[data-reference-carousel]").forEach(carousel => {
    const slides = Array.from(carousel.querySelectorAll("[data-reference-slide]"));
    const previous = carousel.querySelector("[data-reference-previous]");
    const next = carousel.querySelector("[data-reference-next]");
    const counter = carousel.querySelector("[data-reference-counter]");
    if (!slides.length || !previous || !next || !counter) return;
    let index = 0;

    function show(position) {
      index = (position + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => { slide.hidden = slideIndex !== index; });
      counter.textContent = `${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    }

    previous.disabled = next.disabled = slides.length < 2;
    previous.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    carousel.addEventListener("reference:reset", () => show(0));
  });
})();
