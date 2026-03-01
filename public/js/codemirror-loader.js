/**
 * codemirror-loader.js - CodeMirror 6 CDN dynamic loader
 */

const CDN = "https://esm.sh";
let _cmReady = null;

async function loadCodeMirror() {
  if (_cmReady) return _cmReady;
  _cmReady = (async () => {
    const [
      { EditorView, basicSetup },
      { html },
      { css },
      { javascript },
      { oneDark },
      { EditorState },
    ] = await Promise.all([
      import(`${CDN}/codemirror@6`),
      import(`${CDN}/@codemirror/lang-html@6`),
      import(`${CDN}/@codemirror/lang-css@6`),
      import(`${CDN}/@codemirror/lang-javascript@6`),
      import(`${CDN}/@codemirror/theme-one-dark@6`),
      import(`${CDN}/@codemirror/state@6`),
    ]);
    return { EditorView, basicSetup, html, css, javascript, oneDark, EditorState };
  })();
  return _cmReady;
}

window.loadCodeMirror = loadCodeMirror;
