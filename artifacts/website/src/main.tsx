/*
 * Development only. The production build renders the page to HTML and
 * removes this script (see vite.config.ts), so nothing here reaches a
 * visitor except the stylesheet it imports.
 */
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
