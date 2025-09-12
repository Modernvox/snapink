import "./input.css";
import React from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer from "./components/SnapInkSleeveCustomizer";



// If you still want to use a custom logo background, make sure the SVG actually exists
// and the alias resolves, otherwise drop the import and let the customizer use its default
// import logoBg from "@/assets/logo_shape.svg";

function App() {
  return (
    <div className="mx-auto px-4 py-10" style={{ maxWidth: 1600 }}>
      <SnapInkSleeveCustomizer
        width={1600}
        initial={{
          bgType: "image",
          bgFit: "contain",
          posX: 50,
          posY: 55,
        }}
      />
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
  console.error("Missing <div id='customizer-root'> in customize.html");
}
