(function () {
  "use strict";

  const selector = document.getElementById("preview-design");
  const quote = document.getElementById("preview-quote");
  const name = document.getElementById("preview-name");
  const company = document.getElementById("preview-company");
  const apply = document.getElementById("preview-apply");
  const reset = document.getElementById("preview-reset");
  const status = document.getElementById("preview-status");
  if (!selector || !quote || !name || !company || !apply || !reset || !status) return;

  const original = { quote: quote.value, name: name.value, company: company.value };
  const examples = Array.from(document.querySelectorAll(".showcase-cards>article"), card => ({
    quote: card.querySelector("blockquote").textContent.trim(),
    name: card.querySelector(".showcase-card-footer strong").textContent.trim(),
    company: card.querySelector(".showcase-card-footer p span").textContent.trim()
  }));
  const carousels = [];

  function render(container, reference) {
    for (const field of ["quote", "name", "company"]) {
      container.querySelectorAll(`[data-preview-${field}]`).forEach(element => {
        element.textContent = reference[field];
      });
    }
    container.querySelectorAll("[data-preview-initials]").forEach(element => {
      element.textContent = reference.name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toLocaleUpperCase("sv-SE");
    });
  }

  document.querySelectorAll(".reference-section").forEach(section => {
    const previous = section.querySelector("[data-preview-previous]");
    const next = section.querySelector("[data-preview-next]");
    const counter = section.querySelector("[data-preview-counter]");
    if (!previous || !next || !counter || !examples.length) return;
    const carousel = { section, counter, index: 0 };
    carousels.push(carousel);
    section.querySelector("blockquote").setAttribute("aria-live", "polite");
    function move(offset) {
      carousel.index = (carousel.index + offset + examples.length) % examples.length;
      render(section, examples[carousel.index]);
      counter.textContent = `${String(carousel.index + 1).padStart(2, "0")} / ${String(examples.length).padStart(2, "0")}`;
    }
    previous.disabled = next.disabled = false;
    previous.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
  });

  function update(reference, message) {
    examples[0] = reference;
    render(document, reference);
    carousels.forEach(carousel => {
      carousel.index = 0;
      carousel.counter.textContent = `01 / ${String(examples.length).padStart(2, "0")}`;
    });
    status.textContent = message;
  }

  apply.disabled = reset.disabled = selector.disabled = false;
  apply.addEventListener("click", () => {
    quote.setCustomValidity(quote.value.trim() ? "" : "Skriv ett citat att prova.");
    if (!quote.reportValidity()) return;
    update({ quote: quote.value.trim(), name: name.value.trim(), company: company.value.trim() }, "Din referens visas nu i förslagen. Övriga kort i förslag 10 är exempel.");
  });
  quote.addEventListener("input", () => quote.setCustomValidity(""));
  reset.addEventListener("click", () => {
    quote.value = original.quote;
    name.value = original.name;
    company.value = original.company;
    quote.setCustomValidity("");
    update({ ...original }, "Exempelreferensen är återställd.");
  });

  selector.addEventListener("change", () => {
    window.location.hash = selector.value;
  });
  function reflectHash() {
    const id = window.location.hash.slice(1);
    if (Array.from(selector.options).some(option => option.value === id)) selector.value = id;
  }
  window.addEventListener("hashchange", reflectHash);
  reflectHash();
})();
