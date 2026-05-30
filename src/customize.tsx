import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer, {
  type SnapInkSleeveCustomizerRef,
  type SleeveDraft,
} from "./components/SnapInkSleeveCustomizer";

function App() {
  const customizerRef = useRef<SnapInkSleeveCustomizerRef | null>(null);
  const [draft, setDraft] = useState<SleeveDraft | null>(null);
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
      setError(err instanceof Error ? err.message : "Failed to send order");
    }

    setSending(false);
  }

  return (
    <div className="mx-auto px-4 py-10" style={{ maxWidth: 1600 }}>
      <SnapInkSleeveCustomizer
        ref={customizerRef}
        width={1600}
        initial={{
          bgType: "vector",
          posX: 50,
          posY: 55,
        }}
        onChange={(d) => setDraft(d)}
      />

      <div className="mt-10 grid gap-5 rounded-3xl border border-yellow-400/20 bg-neutral-950/70 p-5 shadow-2xl md:grid-cols-[1fr_1.1fr] md:p-7">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-yellow-300">
            Submit your draft
          </p>
          <h2 className="mt-3 text-2xl font-black uppercase leading-tight text-white md:text-3xl">
            Send your custom strap order.
          </h2>
          <p className="mt-3 text-sm leading-6 text-neutral-400">
            Your text, colors, logo placement, safe-area settings, and preview draft are sent to SnapInk for review.
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Your Name"
            className="w-full rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white outline-none focus:border-yellow-400"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />

          <input
            type="email"
            placeholder="Your Email"
            className="w-full rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white outline-none focus:border-yellow-400"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />

          <button
            onClick={sendOrder}
            disabled={sending}
            className="w-full rounded-full bg-yellow-400 px-5 py-3 text-lg font-black text-neutral-950 hover:bg-yellow-300 disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send Order"}
          </button>

          {sent && <p className="text-center text-green-400">Order sent. Check your inbox.</p>}
          {error && <p className="text-center text-red-400">{error}</p>}
        </div>
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
