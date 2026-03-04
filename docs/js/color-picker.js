/**
 * color-picker.js - SB準拠カラーピッカー
 * 2Dグラデーション + 色相スライダー + HEX入力 + プリセット33色
 */

(function () {
  // ── プリセットカラー 33色 ───────────────────────────────
  const PRESET_COLORS = [
    "#000000", "#FFFFFF", "#C0C0C0", "#808080", "#404040", "#FF0000",
    "#800000", "#FF8C00", "#FFE4B5", "#FFA500", "#8B4513", "#FFFF00",
    "#9ACD32", "#556B2F", "#008000", "#90EE90", "#98FB98", "#006400",
    "#87CEEB", "#0000FF", "#800080", "#DDA0DD", "#4B0082", "#191970",
    "#FF6347", "#FF00FF", "#FFB6C1", "#FFC0CB", "#F0E68C", "#ADD8E6",
    "#00CED1", "#7B68EE", "#DC143C",
  ];

  // ── HSV <-> HEX 変換 ─────────────────────────────────────
  function hsvToHex(h, s, v) {
    s /= 100; v /= 100;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  function hexToHsv(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return {
      h: Math.round(h),
      s: Math.round(max === 0 ? 0 : (d / max) * 100),
      v: Math.round(max * 100),
    };
  }

  function hueToColor(h) {
    return hsvToHex(h, 100, 100);
  }

  // ── ColorPicker クラス ────────────────────────────────────
  class ColorPicker {
    constructor() {
      this.h = 0; this.s = 100; this.v = 100;
      this.hex = "#FF0000";
      this.originalHex = "#FF0000";
      this.onApply = null;
      this.onCancel = null;
      this.mode = "text-color";
      this._el = null;
      this._draggingGradient = false;
      this._draggingHue = false;
      this._boundClose = this._handleOutsideClick.bind(this);
      this._boundKeydown = this._handleKeydown.bind(this);
    }

    open(opts) {
      if (this._el) this.close();
      this.onApply = opts.onApply || null;
      this.onCancel = opts.onCancel || null;
      this.mode = opts.mode || "text-color";
      this.originalHex = opts.initialColor || "#FF0000";
      const hsv = hexToHsv(this.originalHex);
      this.h = hsv.h; this.s = hsv.s; this.v = hsv.v;
      this.hex = this.originalHex.toUpperCase();

      this._buildDOM();
      this._position(opts.anchorEl, opts.container);
      this._bindEvents();
      this._updateAll();

      setTimeout(() => {
        document.addEventListener("mousedown", this._boundClose);
        document.addEventListener("keydown", this._boundKeydown);
      }, 50);
    }

    close() {
      document.removeEventListener("mousedown", this._boundClose);
      document.removeEventListener("keydown", this._boundKeydown);
      if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
      this._el = null;
    }

    // ── DOM構築 ──────────────────────────────────────────────
    _buildDOM() {
      const el = document.createElement("div");
      el.className = "color-picker";
      el.innerHTML = `
        <div class="color-picker__gradient" id="cp-gradient">
          <div class="color-picker__gradient-cursor" id="cp-grad-cursor"></div>
        </div>
        <div class="color-picker__hue-row">
          <div class="color-picker__preview-dots">
            <span class="color-picker__dot-current" id="cp-dot-current"></span>
            <span class="color-picker__dot-original" id="cp-dot-original"></span>
          </div>
          <div class="color-picker__hue-wrap">
            <div class="color-picker__hue-bar" id="cp-hue-bar">
              <div class="color-picker__hue-thumb" id="cp-hue-thumb"></div>
            </div>
          </div>
        </div>
        <div class="color-picker__hex-row">
          <input type="text" class="color-picker__hex-input" id="cp-hex-input" maxlength="7" spellcheck="false">
        </div>
        <div class="color-picker__presets" id="cp-presets"></div>
        <button class="color-picker__apply-btn" id="cp-apply">適用する</button>
      `;

      // CSS injection (only once per document)
      if (!document.getElementById("color-picker-styles")) {
        const style = document.createElement("style");
        style.id = "color-picker-styles";
        style.textContent = this._getCSS();
        document.head.appendChild(style);
      }

      // Build preset grid
      const presetsEl = el.querySelector("#cp-presets");
      PRESET_COLORS.forEach((c) => {
        const cell = document.createElement("div");
        cell.className = "color-picker__preset-cell";
        cell.style.background = c;
        cell.dataset.color = c;
        presetsEl.appendChild(cell);
      });

      // Set original dot color
      el.querySelector("#cp-dot-original").style.background = this.originalHex;

      (document.body || document.documentElement).appendChild(el);
      this._el = el;
    }

    _position(anchorEl, container) {
      if (!this._el) return;
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        let top = rect.bottom + 8;
        let left = rect.left;
        // Adjust if overflows right
        if (left + 300 > window.innerWidth) left = window.innerWidth - 316;
        // Adjust if overflows bottom
        if (top + 500 > window.innerHeight) top = rect.top - 500 - 8;
        if (left < 4) left = 4;
        if (top < 4) top = 4;
        this._el.style.position = "fixed";
        this._el.style.top = top + "px";
        this._el.style.left = left + "px";
      }
    }

    // ── イベント ─────────────────────────────────────────────
    _bindEvents() {
      const el = this._el;
      if (!el) return;
      const grad = el.querySelector("#cp-gradient");
      const hueBar = el.querySelector("#cp-hue-bar");
      const hexInput = el.querySelector("#cp-hex-input");
      const applyBtn = el.querySelector("#cp-apply");
      const presets = el.querySelector("#cp-presets");

      // Gradient interactions
      const gradientHandler = (e) => {
        e.preventDefault();
        const rect = grad.getBoundingClientRect();
        const cx = ("touches" in e) ? e.touches[0].clientX : e.clientX;
        const cy = ("touches" in e) ? e.touches[0].clientY : e.clientY;
        const x = Math.max(0, Math.min(cx - rect.left, rect.width));
        const y = Math.max(0, Math.min(cy - rect.top, rect.height));
        this.s = Math.round((x / rect.width) * 100);
        this.v = Math.round(100 - (y / rect.height) * 100);
        this.hex = hsvToHex(this.h, this.s, this.v);
        this._updateAll();
      };

      grad.addEventListener("mousedown", (e) => {
        this._draggingGradient = true;
        gradientHandler(e);
        const onMove = (ev) => { if (this._draggingGradient) gradientHandler(ev); };
        const onUp = () => { this._draggingGradient = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      grad.addEventListener("touchstart", (e) => {
        this._draggingGradient = true;
        gradientHandler(e);
        const onMove = (ev) => { if (this._draggingGradient) gradientHandler(ev); };
        const onEnd = () => { this._draggingGradient = false; document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onEnd); };
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onEnd);
      }, { passive: false });

      // Hue bar interactions
      const hueHandler = (e) => {
        e.preventDefault();
        const rect = hueBar.getBoundingClientRect();
        const cx = ("touches" in e) ? e.touches[0].clientX : e.clientX;
        const x = Math.max(0, Math.min(cx - rect.left, rect.width));
        this.h = Math.round((x / rect.width) * 360);
        this.hex = hsvToHex(this.h, this.s, this.v);
        this._updateAll();
      };

      hueBar.addEventListener("mousedown", (e) => {
        this._draggingHue = true;
        hueHandler(e);
        const onMove = (ev) => { if (this._draggingHue) hueHandler(ev); };
        const onUp = () => { this._draggingHue = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      hueBar.addEventListener("touchstart", (e) => {
        this._draggingHue = true;
        hueHandler(e);
        const onMove = (ev) => { if (this._draggingHue) hueHandler(ev); };
        const onEnd = () => { this._draggingHue = false; document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onEnd); };
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onEnd);
      }, { passive: false });

      // HEX input
      hexInput.addEventListener("input", () => {
        let val = hexInput.value.trim();
        if (!val.startsWith("#")) val = "#" + val;
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
          const hsv = hexToHsv(val);
          this.h = hsv.h; this.s = hsv.s; this.v = hsv.v;
          this.hex = val.toUpperCase();
          this._updateAll(true);
        } else if (/^#[0-9A-Fa-f]{3}$/.test(val)) {
          const expanded = "#" + val[1]+val[1]+val[2]+val[2]+val[3]+val[3];
          const hsv = hexToHsv(expanded);
          this.h = hsv.h; this.s = hsv.s; this.v = hsv.v;
          this.hex = expanded.toUpperCase();
          this._updateAll(true);
        }
      });

      // Presets
      presets.addEventListener("click", (e) => {
        const cell = e.target.closest(".color-picker__preset-cell");
        if (!cell) return;
        const c = cell.dataset.color;
        const hsv = hexToHsv(c);
        this.h = hsv.h; this.s = hsv.s; this.v = hsv.v;
        this.hex = c.toUpperCase();
        this._updateAll();
        // Highlight selected
        presets.querySelectorAll(".color-picker__preset-cell--selected").forEach((el) => el.classList.remove("color-picker__preset-cell--selected"));
        cell.classList.add("color-picker__preset-cell--selected");
      });

      // Apply button
      applyBtn.addEventListener("click", () => {
        if (this.onApply) this.onApply(this.hex);
        this.close();
      });
    }

    _handleOutsideClick(e) {
      if (this._el && !this._el.contains(e.target)) {
        if (this.onCancel) this.onCancel();
        this.close();
      }
    }

    _handleKeydown(e) {
      if (e.key === "Escape") {
        if (this.onCancel) this.onCancel();
        this.close();
      }
    }

    // ── 全UI更新 ─────────────────────────────────────────────
    _updateAll(skipInput) {
      if (!this._el) return;

      // Gradient background (hue color)
      const grad = this._el.querySelector("#cp-gradient");
      grad.style.background = `linear-gradient(to bottom, transparent 0%, #000 100%), linear-gradient(to right, #fff 0%, ${hueToColor(this.h)} 100%)`;

      // Gradient cursor position
      const cursor = this._el.querySelector("#cp-grad-cursor");
      cursor.style.left = this.s + "%";
      cursor.style.top = (100 - this.v) + "%";

      // Hue thumb position
      const hueThumb = this._el.querySelector("#cp-hue-thumb");
      hueThumb.style.left = (this.h / 360 * 100) + "%";
      hueThumb.style.background = hueToColor(this.h);

      // Current dot
      const dotCurrent = this._el.querySelector("#cp-dot-current");
      dotCurrent.style.background = this.hex;

      // HEX input
      if (!skipInput) {
        const hexInput = this._el.querySelector("#cp-hex-input");
        hexInput.value = this.hex;
      }
    }

    // ── CSS ──────────────────────────────────────────────────
    _getCSS() {
      return `
.color-picker {
  width: 300px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  padding: 16px;
  z-index: 9999;
  font-family: -apple-system, "Hiragino Sans", sans-serif;
}
.color-picker > * + * { margin-top: 12px; }

.color-picker__gradient {
  width: 100%;
  height: 180px;
  position: relative;
  border-radius: 4px;
  cursor: crosshair;
  background:
    linear-gradient(to bottom, transparent 0%, #000 100%),
    linear-gradient(to right, #fff 0%, #ff0000 100%);
}
.color-picker__gradient-cursor {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 2px rgba(0,0,0,0.6);
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.color-picker__hue-row {
  display: flex; align-items: center; gap: 10px;
}
.color-picker__preview-dots {
  display: flex; gap: 4px; flex-shrink: 0;
}
.color-picker__dot-current, .color-picker__dot-original {
  width: 20px; height: 20px;
  border-radius: 50%;
  border: 2px solid #ddd;
}
.color-picker__dot-original { border-style: dashed; }
.color-picker__hue-wrap {
  flex: 1; position: relative; height: 16px;
  display: flex; align-items: center;
}
.color-picker__hue-bar {
  width: 100%; height: 12px;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  background: linear-gradient(to right,
    #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%,
    #0000ff 67%, #ff00ff 83%, #ff0000 100%);
}
.color-picker__hue-thumb {
  width: 16px; height: 16px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 3px rgba(0,0,0,0.4);
  position: absolute;
  top: 50%; transform: translate(-50%, -50%);
  pointer-events: none;
}

.color-picker__hex-row { display: flex; gap: 8px; }
.color-picker__hex-input {
  width: 100%; height: 40px;
  border: 1px solid #ddd;
  border-radius: 8px;
  text-align: center;
  font-size: 16px;
  font-family: monospace;
  color: #333;
  outline: none;
  box-sizing: border-box;
}
.color-picker__hex-input:focus { border-color: #2196F3; }

.color-picker__presets {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.color-picker__preset-cell {
  width: 100%; aspect-ratio: 1;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid rgba(0,0,0,0.1);
  transition: transform 0.1s;
  box-sizing: border-box;
}
.color-picker__preset-cell:hover {
  transform: scale(1.15);
  border: 2px solid #333;
  z-index: 1;
}
.color-picker__preset-cell--selected {
  border: 2px solid #007AFF;
  box-shadow: 0 0 0 2px rgba(0,122,255,0.3);
}

.color-picker__apply-btn {
  width: 100%; height: 48px;
  background: #2196F3;
  color: #fff; border: none;
  border-radius: 8px;
  font-size: 16px; font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  font-family: -apple-system, "Hiragino Sans", sans-serif;
}
.color-picker__apply-btn:hover { background: #1976D2; }
.color-picker__apply-btn:active { background: #0D47A1; }
`;
    }
  }

  // ── シングルトンインスタンスをwindowに公開 ──────────────
  window.ColorPicker = new ColorPicker();
})();
