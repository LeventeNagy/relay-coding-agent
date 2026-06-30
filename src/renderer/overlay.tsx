import React from "react";
import ReactDOM from "react-dom/client";
import { OverlayApp } from "./OverlayApp";
import "./overlay.css";

ReactDOM.createRoot(document.getElementById("overlay-root") as HTMLElement).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>
);
