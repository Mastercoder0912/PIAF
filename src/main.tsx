import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import App from "./App";
import "./styles.css";

inject();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
