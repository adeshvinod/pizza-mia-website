/* Halloween: skeletons drifting down the homepage (only while <html class="halloween">). */
(function () {
  "use strict";
  if (!document.documentElement.classList.contains("halloween")) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var SKEL = '<svg viewBox="0 0 40 80" aria-hidden="true"><g stroke="#EDE6D6" stroke-width="2.4" stroke-linecap="round" fill="none">' +
    '<path d="M20 19V48"/><path d="M13 25Q20 22 27 25M12 30Q20 27 28 30M13 35Q20 32 27 35"/><path d="M14 47Q20 54 26 47"/>' +
    '<path d="M14 23L7 14L4 5M26 23L33 14L36 5"/><path d="M16 50L12 64L10 75M24 50L28 64L30 75"/></g>' +
    '<circle cx="20" cy="10" r="8" fill="#EDE6D6"/><rect x="16" y="15" width="8" height="4" rx="1.5" fill="#EDE6D6"/>' +
    '<circle cx="17" cy="9" r="2.2" fill="#121A15"/><circle cx="23" cy="9" r="2.2" fill="#121A15"/></svg>';
  var n = window.innerWidth < 600 ? 6 : 11, box = document.createElement("div"), h = "";
  box.className = "hw-skels"; box.setAttribute("aria-hidden", "true");
  for (var i = 0; i < n; i++) {
    var size = 30 + Math.round(Math.random() * 30);
    h += '<div class="hw-skel" style="left:' + (2 + (i / n) * 92 + Math.random() * 4).toFixed(1) + '%;width:' + size + 'px;opacity:' +
      (0.45 + Math.random() * 0.35).toFixed(2) + ';animation-duration:' + (11 + Math.random() * 9).toFixed(1) + 's;animation-delay:-' +
      (Math.random() * 20).toFixed(1) + 's">' + SKEL.replace("<svg ", '<svg width="' + size + '" height="' + size * 2 + '" ') + '</div>';
  }
  box.innerHTML = h;
  document.body.appendChild(box);
})();
