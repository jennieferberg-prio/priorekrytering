(function () {
  "use strict";

  const applyLink = document.querySelector("[data-job-apply]");
  if (!applyLink) return;

  applyLink.addEventListener("click", function (event) {
    event.preventDefault();
    const popupWidth = Math.max(320, Math.min(960, window.screen.availWidth - 40));
    const popupHeight = Math.max(500, Math.min(900, window.screen.availHeight - 40));
    const popupLeft = (window.screen.availLeft || 0) + Math.round((window.screen.availWidth - popupWidth) / 2);
    const popupTop = (window.screen.availTop || 0) + Math.round((window.screen.availHeight - popupHeight) / 2);
    const features = `popup=yes,width=${popupWidth},height=${popupHeight},left=${popupLeft},top=${popupTop},resizable=yes,scrollbars=yes`;
    const popup = window.open(applyLink.href, "pnty_application", features);
    if (popup) {
      popup.opener = null;
      popup.focus();
    }
  });
})();
