import { StrictMode } from "react";
import { MotionConfig } from "framer-motion";
import { createRoot } from "react-dom/client";
import "@seed-design/css/all.css";

import { App } from "./App";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root가 없습니다.");

createRoot(root).render(
  <StrictMode>
    {/* 시스템 「동작 줄이기」를 framer-motion 모션에도 따른다 */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
