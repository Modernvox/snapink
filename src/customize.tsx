import React from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer from "./components/SnapInkSleeveCustomizer";

function App() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <SnapInkSleeveCustomizer width={1000} />
    </div>
  );
}

const mount = document.getElementById("customizer-root");
if (mount) {
  createRoot(mount).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Missing <main id='customizer-root'> in customize.html");
}
