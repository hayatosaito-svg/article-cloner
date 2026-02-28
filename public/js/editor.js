/**
 * editor.js - Split pane drag + touch support
 */

const divider = document.getElementById("split-divider");
const paneLeft = document.getElementById("pane-left");

let isDragging = false;
let containerRect = null;

function startDrag(e) {
  isDragging = true;
  containerRect = divider.parentElement.getBoundingClientRect();
  divider.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
}

function doDrag(clientX) {
  if (!isDragging || !containerRect) return;
  const x = clientX - containerRect.left;
  const pct = Math.max(20, Math.min(60, (x / containerRect.width) * 100));
  paneLeft.style.width = `${pct}%`;
  paneLeft.style.flex = "none";
}

function endDrag() {
  if (!isDragging) return;
  isDragging = false;
  containerRect = null;
  divider.classList.remove("dragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

// Mouse events
divider?.addEventListener("mousedown", startDrag);
document.addEventListener("mousemove", (e) => doDrag(e.clientX));
document.addEventListener("mouseup", endDrag);

// Touch events
divider?.addEventListener("touchstart", (e) => {
  startDrag(e);
}, { passive: false });

document.addEventListener("touchmove", (e) => {
  if (isDragging && e.touches[0]) {
    doDrag(e.touches[0].clientX);
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener("touchend", endDrag);
