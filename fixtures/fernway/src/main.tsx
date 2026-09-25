import "@fontsource-variable/inter";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadBugs } from "./lib/bugs";

// Bugs are switched at runtime (GET /api/__config); load them first so bugOn() is right from the first render.
void loadBugs().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
