import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SnapInkSleeveCustomizer, {
  type SnapInkSleeveCustomizerRef,
  type SleeveDraft,
} from "./components/SnapInkSleeveCustomizer";

type SubmissionResult = { reference: string };

function newSubmissionKey() {
  return crypto.randomUUID().replaceAll("-", "");
}

function App() {
  const customizerRef = useRef<SnapInkSleeveCustomizerRef | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<SleeveDraft | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState("");

  function changeDesign(nextDraft: SleeveDraft) {
    idempotencyKeyRef.current = null;
    setDraft(nextDraft);
    setSubmitted(null);
    setError("");
  }

  async function sendDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!draft) {
      setError("Your design is still loading. Please wait a moment and try again.");
      return;
    }
    const name = customerName.trim();
    const email = customerEmail.trim();
    if (!name || !email) {
      setError("Enter your name and email address to submit your design.");
      return;
    }
    if (!customizerRef.current) {
      setError("The design workspace is unavailable. Refresh the page and try again.");
      return;
    }

    submittingRef.current = true;
    setSending(true);
    setError("");
    try {
      const files = await customizerRef.current.getOrderFiles();
      const draftPayload = { ...draft, logoDataUrl: undefined };
      const res = await fetch("/api/design-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name, email, phone: customerPhone.trim() || undefined },
          quantity,
          draft: draftPayload,
          files: { ...files, sourceArtwork: draft.logoName ? files.sourceArtwork : undefined },
          submittedAt: new Date().toISOString(),
          idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = newSubmissionKey()),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `We could not save your design (HTTP ${res.status}). Please try again.`);
      if (!data?.draft?.reference) throw new Error("The server did not return a draft reference. Contact SnapInk before resubmitting.");
      setSubmitted({ reference: data.draft.reference });
      idempotencyKeyRef.current = null;
      setCustomerName("");
      setCustomerEmail("");
      setCustomerPhone("");
      setQuantity(1);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "We could not save your design. Please try again.");
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] py-0">
      <div className="snapink-studio-application">
        <SnapInkSleeveCustomizer
          ref={customizerRef}
          width={1440}
          className="snapink-studio-customizer"
          initial={{ bgType: "vector" }}
          defaultArtworkPosition={{ posX: 53.3, posY: 80 }}
          onChange={changeDesign}
        />

        <section className="snapink-studio-submission grid gap-5 md:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-si-accent">Submit your draft</p>
            <h2 className="mt-3 text-2xl font-black uppercase leading-tight text-white md:text-3xl">Submit your design for review.</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-300">
              Send your custom sleeve design to SnapInk for review. This is a design review request only; it does not place a paid order or guarantee production.
            </p>
          </div>

          <form className="space-y-4" onSubmit={sendDraft}>
            <input
              type="text"
              placeholder="Your Name"
              aria-label="Your name"
              autoComplete="name"
              maxLength={120}
              required
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-white outline-none focus:border-si-accent"
              value={customerName}
              onChange={(event) => { idempotencyKeyRef.current = null; setCustomerName(event.target.value); setSubmitted(null); }}
            />
            <input
              type="email"
              placeholder="Your Email"
              aria-label="Your email"
              autoComplete="email"
              maxLength={254}
              required
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-white outline-none focus:border-si-accent"
              value={customerEmail}
              onChange={(event) => { idempotencyKeyRef.current = null; setCustomerEmail(event.target.value); setSubmitted(null); }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                type="tel"
                placeholder="Phone (optional)"
                aria-label="Phone number (optional)"
                autoComplete="tel"
                maxLength={40}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-white outline-none focus:border-si-accent"
                value={customerPhone}
                onChange={(event) => { idempotencyKeyRef.current = null; setCustomerPhone(event.target.value); setSubmitted(null); }}
              />
              <label className="grid gap-1 text-sm text-neutral-200">
                Quantity
                <input
                  type="number"
                  aria-label="Quantity"
                  min={1}
                  max={50}
                  step={1}
                  required
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-white outline-none focus:border-si-accent"
                  value={quantity}
                  onChange={(event) => { idempotencyKeyRef.current = null; setQuantity(Number(event.target.value)); setSubmitted(null); }}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-full bg-si-button px-5 py-3 text-lg font-black text-neutral-950 hover:bg-si-hover disabled:opacity-50"
            >
              {sending ? "Submitting Design…" : "Submit Design for Review"}
            </button>
            {submitted && (
              <p className="text-center text-green-300" role="status" aria-live="polite">
                Your SnapInk design has been received! Reference: {submitted.reference}. Our team will review your design and contact you about production options.
              </p>
            )}
            {error && <p className="text-center text-red-300" role="alert">{error}</p>}
            <p className="text-xs leading-5 text-neutral-400">Submitting a design does not place a paid order or guarantee production. No payment is collected here.</p>
          </form>
        </section>
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
