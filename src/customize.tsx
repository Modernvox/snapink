import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RETAIL_MAX_QUANTITY } from "../functions/_lib/retail-pricing.mjs";
import SnapInkSleeveCustomizer, { type SnapInkSleeveCustomizerRef, type SleeveDraft } from "./components/SnapInkSleeveCustomizer";

type SubmissionResult = { orderNumber: string; customerEmailSent: boolean; ownerEmailSent: boolean };
function newSubmissionKey() { return crypto.randomUUID().replace(/-/g, ""); }

function App() {
  const customizerRef = useRef<SnapInkSleeveCustomizerRef | null>(null);
  const draftRef = useRef<SleeveDraft | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<SleeveDraft | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState("");
  const editOrder = (setter: (value: string) => void, value: string) => { idempotencyKeyRef.current = null; setter(value); setSubmitted(null); };

  function changeDesign(nextDraft: SleeveDraft) {
    draftRef.current = nextDraft;
    idempotencyKeyRef.current = null;
    setDraft(nextDraft); setSubmitted(null); setError("");
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!draft || !customizerRef.current) { setError("Your design is still loading. Please wait a moment and try again."); return; }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > RETAIL_MAX_QUANTITY) { setError(`Quantity must be between 1 and ${RETAIL_MAX_QUANTITY}.`); return; }
    submittingRef.current = true; setSending(true); setError("");
    const submittedDraft = draft;
    try {
      const files = await customizerRef.current.getOrderFiles();
      if (JSON.stringify(draftRef.current) !== JSON.stringify(submittedDraft)) throw new Error("Your design changed while the submission was being prepared. Please submit it again so the preview and design details match.");
      const res = await fetch("/api/retail-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: customerName.trim(), email: customerEmail.trim() },
          quantity,
          draft: { ...submittedDraft, logoDataUrl: undefined },
          files: { ...files, sourceArtwork: submittedDraft.logoName ? files.sourceArtwork : undefined },
          idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = newSubmissionKey()),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `We could not save your design (HTTP ${res.status}). Please try again.`);
      if (!data?.order?.orderNumber) throw new Error("The server did not return a review reference. Contact SnapInk before resubmitting.");
      setSubmitted({ orderNumber: data.order.orderNumber, customerEmailSent: data.order.notifications?.customer === "sent" || data.order.customerEmailStatus === "sent", ownerEmailSent: data.order.notifications?.owner === "sent" || data.order.ownerEmailStatus === "sent" });
      idempotencyKeyRef.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "We could not save your design. Please try again."); }
    finally { submittingRef.current = false; setSending(false); }
  }

  return <div className="mx-auto w-full max-w-[1440px] py-0">
    <div className="snapink-studio-application">
      <SnapInkSleeveCustomizer ref={customizerRef} width={1440} className="snapink-studio-customizer" initial={{ bgType: "vector" }} defaultArtworkPosition={{ posX: 53.3, posY: 80, desktopPosY: 56.5 }} onChange={changeDesign} />
      <section className="snapink-studio-submission snapink-draft-submission snapink-retail-order">
        {submitted ? <div className="snapink-retail-success" role="status" aria-live="polite">
          <p className="snapink-draft-eyebrow">DESIGN REVIEW</p>
          <h2 className="snapink-draft-heading">Design Submitted!</h2>
          <p className="snapink-draft-description">Your custom SnapInk Sleeve design has been received for review. We'll contact you by email with the next steps.</p>
          <p className="snapink-retail-total"><strong>Review reference {submitted.orderNumber}</strong></p>
          {!submitted.ownerEmailSent && <p className="snapink-retail-email-note" role="status">Your design was saved, but the SnapInk review notification could not be sent. Please contact partners@snapbacksleeves.com and include your review reference.</p>}
          {!submitted.customerEmailSent && <p className="snapink-retail-email-note" role="status">Your design is saved, but the confirmation email could not be sent. SnapInk will review it; if you need help, contact support@snapbacksleeves.com and include your review reference.</p>}
        </div> : <>
          <div className="snapink-retail-copy">
            <p className="snapink-draft-eyebrow">CUSTOM SLEEVE DESIGN REVIEW</p>
            <h2 className="snapink-draft-heading">READY TO SHARE YOUR DESIGN?</h2>
            <p className="snapink-draft-description">Submit your custom sleeve design for review. No payment required. We will check that your design can be produced and contact you by email with the next steps.</p>
          </div>
          <div className="snapink-retail-layout">
            <aside className="snapink-retail-summary" aria-live="polite">
              <h3>DESIGN SUMMARY</h3>
              {draft ? <dl>
                <div><dt>Selected sleeve style</dt><dd>{draft.variant === "billboard" ? "Billboard" : "Standard"}</dd></div>
                <div><dt>Selected size</dt><dd>Size {draft.size}</dd></div>
                <div><dt>Sleeve color</dt><dd>{draft.backgroundColor}</dd></div>
                <div><dt>Quantity</dt><dd>{quantity}</dd></div>
                {draft.text ? <div><dt>Custom text</dt><dd>{draft.text}</dd></div> : null}
              </dl> : <p>Loading your design summary…</p>}
            </aside>
            <form className="snapink-draft-form snapink-retail-form" onSubmit={submitOrder}>
              <div className="grid gap-4 sm:grid-cols-2">
                <input type="text" placeholder="Your name" aria-label="Your name" autoComplete="name" maxLength={120} required className="snapink-draft-field" value={customerName} onChange={e => editOrder(setCustomerName, e.target.value)} />
                <input type="email" placeholder="Email address" aria-label="Email address" autoComplete="email" maxLength={254} required className="snapink-draft-field" value={customerEmail} onChange={e => editOrder(setCustomerEmail, e.target.value)} />
                <label className="snapink-draft-quantity grid gap-1 text-sm">Quantity
                  <input type="number" aria-label="Quantity" min={1} max={RETAIL_MAX_QUANTITY} step={1} required className="snapink-draft-field" value={quantity} onChange={e => { idempotencyKeyRef.current = null; setSubmitted(null); setQuantity(e.target.value === "" ? 0 : Number(e.target.value)); }} />
                </label>
              </div>
              <button type="submit" disabled={sending || !draft || !Number.isInteger(quantity) || quantity < 1 || quantity > RETAIL_MAX_QUANTITY} className="w-full rounded-full bg-si-button px-5 py-3 text-lg font-black text-neutral-950 hover:bg-si-hover disabled:opacity-50">
                {sending ? "SUBMITTING DESIGN…" : "SUBMIT DESIGN FOR REVIEW"}
              </button>
              {error && <p className="text-center text-red-700" role="alert">{error}</p>}
              <div className="snapink-draft-disclaimer">
                <p><strong>No payment required.</strong></p>
                <p>Submit your custom sleeve design for review. We'll check that your design can be produced and contact you by email with the next steps.</p>
                <p>Submitting a design does not place a paid order or guarantee production approval.</p>
              </div>
            </form>
          </div>
        </>}
      </section>
    </div>
  </div>;
}

const mount = document.getElementById("customizer-root");
if (mount) createRoot(mount).render(<React.StrictMode><App /></React.StrictMode>);
else console.error("Missing <div id='customizer-root'> in customize.html");
