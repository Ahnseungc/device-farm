import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@seed-design/css/all.css";

import { App } from "./App";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root가 없습니다.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
