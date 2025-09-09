import React from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer from "./components/SnapInkSleeveCustomizer";

// Import your SVG so Vite emits it and gives us a URL
// (make sure logo_shape.svg lives at src/assets/logo_shape.svg)
import logoBg from "@/assets/logo_shape.svg";

function App() {
  return (
    <div className="mx-auto px-4 py-10" style={{ maxWidth: 1600 }}>
      <SnapInkSleeveCustomizer
        backgroundImageUrl={logoBg} // ✅ use your SVG as the background
        width={1600}                // cap page width so UI doesn’t blow up
        initial={{                  // optional: sensible defaults
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
