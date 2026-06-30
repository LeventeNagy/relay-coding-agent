import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import "./pet.css";

/**
 * Last-resort overlay for errors that escape React (event handlers, async
 * rejections). Guarantees the window never goes silently blank.
 */
const showGlobalError = (label: string, detail: unknown): void => {
  // eslint-disable-next-line no-console
  console.error(label, detail);
  const message =
    detail instanceof Error ? `${detail.message}\n\n${detail.stack ?? ""}` : String(detail);
  let overlay = document.getElementById("relay-global-error");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "relay-global-error";
    overlay.className = "crash-screen";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = "";
  const card = document.createElement("div");
  card.className = "crash-card";
  const heading = document.createElement("h2");
  heading.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = message;
  card.append(heading, pre);
  overlay.appendChild(card);
};

window.addEventListener("error", (event) => showGlobalError("Uncaught error", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) =>
  showGlobalError("Unhandled promise rejection", event.reason)
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
