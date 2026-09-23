import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/*
 * Screens past the first are separate files with hashed names, and a deploy
 * replaces them. A tab left open across a deploy still points at the old
 * names, so the next screen it opens fails to load. Vite reports that here;
 * reloading picks up the new build. The timestamp stops a genuinely broken
 * build, or a dropped connection, from reloading in a loop.
 */
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "chunk-reload-at";
  try {
    const last = Number(window.sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage blocked: with no way to tell a first failure from a tenth,
    // reloading could loop forever. Let the error surface instead.
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
