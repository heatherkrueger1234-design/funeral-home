import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";

/** Called once at build time by the prerender step in vite.config.ts. */
export function render(): string {
  return renderToStaticMarkup(<App />);
}
