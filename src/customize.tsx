import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer from "./components/SnapInkSleeveCustomizer";

function App() {
  const customizerRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendOrder() {
    if (!draft) return alert("Please create a strap first.");
    if (!customerEmail.includes("@")) return alert("Enter a valid email address.");

    setSending(true);
    setError("");
    setSent(false);

    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          customerEmail,
          draft,
          submittedAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) throw new Error("Failed to send order");

      setSent(true);
      setCustomerName("");
      setCustomerEmail("");
    } catch (err) {
      setError(err.message);
    }

    setSending(false);
  }

  return (
    <div className="mx-auto px-4 py-10" style={{ maxWidth: 1600 }}>
      <SnapInkSleeveCustomizer
        ref={customizerRef}
        width={1600}
        initial={{
          bgType: "image",
          bgFit: "contain",
          posX: 50,
          posY: 55,
        }}
        onChange={(d) => setDraft(d)}
      />

      {/* Order Form */}
      <div className="mt-10 bg-neutral-900 border border-neutral-800 p-6 rounded-xl max-w-xl mx-auto space-y-4">
        <h2 className="text-xl font-semibold text-white text-center">
          Send Your Custom Strap Order
        </h2>

        <input
          type="text"
          placeholder="Your Name"
          className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-white"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />

        <input
          type="email"
          placeholder="Your Email"
          className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-white"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
        />

        <button
          onClick={sendOrder}
          disabled={sending}
          className="w-full py-3 text-lg font-semibold bg-pink-600 hover:bg-pink-500 rounded-lg text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send Order"}
        </button>

        {sent && <p className="text-green-400 text-center">Order sent! Check your inbox.</p>}
        {error && <p className="text-red-400 text-center">{error}</p>}
      </div>
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
