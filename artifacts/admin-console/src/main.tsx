import { createRoot } from "react-dom/client";
import App from "./App";
import { CrashBoundary } from "./components/CrashBoundary";
import { installCrashReporting } from "./lib/crash-report";
import "./index.css";

// First, so a failure anywhere after this line is heard about.
installCrashReporting("admin");

createRoot(document.getElementById("root")!).render(
  <CrashBoundary whole>
    <App />
  </CrashBoundary>,
);
