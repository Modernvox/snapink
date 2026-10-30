import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { calculateRetailPricing, RETAIL_MAX_QUANTITY } from "../functions/_lib/retail-pricing.mjs";
import SnapInkSleeveCustomizer, { type SnapInkSleeveCustomizerRef, type SleeveDraft } from "./components/SnapInkSleeveCustomizer";

type SubmissionResult = { orderNumber: string; totalBeforeTaxCents: number; customerEmailSent: boolean };
function newSubmissionKey() { return crypto.randomUUID().replace(/-/g, ""); }
function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }

function App() {
  const customizerRef = useRef<SnapInkSleeveCustomizerRef | null>(null);
  const draftRef = useRef<SleeveDraft | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<SleeveDraft | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState("");
  const pricing = draft && Number.isInteger(quantity) && quantity >= 1 && quantity <= RETAIL_MAX_QUANTITY
    ? calculateRetailPricing(draft.size, quantity) : null;
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
      if (JSON.stringify(draftRef.current) !== JSON.stringify(submittedDraft)) throw new Error("Your design changed while the order was being prepared. Please submit it again so the preview and design details match.");
      const res = await fetch("/api/retail-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: customerName.trim(), email: customerEmail.trim(), phone: customerPhone.trim() || undefined },
          shippingAddress: { line1, line2, city, region, postalCode, country }, quantity,
          draft: { ...submittedDraft, logoDataUrl: undefined },
          files: { ...files, sourceArtwork: submittedDraft.logoName ? files.sourceArtwork : undefined },
          idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = newSubmissionKey()),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `We could not save your order (HTTP ${res.status}). Please try again.`);
      if (!data?.order?.orderNumber) throw new Error("The server did not return an order number. Contact SnapInk before resubmitting.");
      setSubmitted({ orderNumber: data.order.orderNumber, totalBeforeTaxCents: Number(data.order.totalBeforeTaxCents ?? pricing?.totalBeforeTaxCents ?? 0), customerEmailSent: data.order.notifications?.customer === "sent" || data.order.customerEmailStatus === "sent" });
      idempotencyKeyRef.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "We could not save your order. Please try again."); }
    finally { submittingRef.current = false; setSending(false); }
  }

  return <div className="mx-auto w-full max-w-[1440px] py-0">
    <div className="snapink-studio-application">
      <SnapInkSleeveCustomizer ref={customizerRef} width={1440} className="snapink-studio-customizer" initial={{ bgType: "vector" }} defaultArtworkPosition={{ posX: 53.3, posY: 80, desktopPosY: 56.5 }} onChange={changeDesign} />
      <section className="snapink-studio-submission snapink-draft-submission snapink-retail-order">
        {submitted ? <div className="snapink-retail-success" role="status" aria-live="polite">
          <p className="snapink-draft-eyebrow">CUSTOM ORDER</p>
          <h2 className="snapink-draft-heading">YOUR CUSTOM ORDER HAS BEEN RECEIVED!</h2>
          <p className="snapink-draft-description">Thanks for designing with SnapInk! We're confirming your sleeve is ready for production. Once approved, we'll email you a secure Stripe payment link. No payment has been collected yet.</p>
          <p className="snapink-retail-total"><strong>Order {submitted.orderNumber}</strong><span>{money(submitted.totalBeforeTaxCents)} before applicable taxes</span></p>
          {!submitted.customerEmailSent && <p className="snapink-retail-email-note" role="status">Your order is saved, but the confirmation email could not be sent. SnapInk will review your order; if you need help, contact support@snapbacksleeves.com and include your order number.</p>}
        </div> : <>
          <div className="snapink-retail-copy">
            <p className="snapink-draft-eyebrow">CUSTOM SLEEVE ORDER</p>
            <h2 className="snapink-draft-heading">LOVE YOUR DESIGN? LET'S MAKE IT REAL.</h2>
            <p className="snapink-draft-description">Your custom SnapInk Sleeve is ready for the next step. Choose your quantity, see your price instantly, and send us your order. We'll confirm production and email your secure payment link.</p>
          </div>
          <div className="snapink-retail-layout">
            <aside className="snapink-retail-summary" aria-live="polite">
              <h3>ORDER SUMMARY</h3>
              {draft ? <dl>
                <div><dt>Selected sleeve style</dt><dd>{draft.variant === "billboard" ? "Billboard" : "Standard"}</dd></div>
                <div><dt>Selected size</dt><dd>Size {draft.size}</dd></div>
                <div><dt>Quantity</dt><dd>{pricing ? quantity : "—"}</dd></div>
                <div><dt>Unit price</dt><dd>{pricing ? money(pricing.unitPriceCents) : "—"}</dd></div>
                <div><dt>Merchandise subtotal</dt><dd>{pricing ? money(pricing.merchandiseSubtotalCents) : "—"}</dd></div>
                {pricing?.discountCents ? <div><dt>Quantity discount</dt><dd>−{money(pricing.discountCents)}</dd></div> : null}
                <div><dt>Shipping</dt><dd>{pricing ? (pricing.shippingCents ? money(pricing.shippingCents) : "Free") : "—"}</dd></div>
                <div className="snapink-retail-total"><dt>Total before applicable taxes</dt><dd>{pricing ? money(pricing.totalBeforeTaxCents) : "—"}</dd></div>
              </dl> : <p>Loading your design summary…</p>}
              <p className="snapink-retail-tax-note">Any applicable taxes will be calculated separately at secure Stripe checkout.</p>
            </aside>
            <form className="snapink-draft-form snapink-retail-form" onSubmit={submitOrder}>
              <div className="grid gap-4 sm:grid-cols-2">
                <input type="text" placeholder="Your name" aria-label="Your name" autoComplete="name" maxLength={120} required className="snapink-draft-field" value={customerName} onChange={e => editOrder(setCustomerName, e.target.value)} />
                <input type="email" placeholder="Email address" aria-label="Email address" autoComplete="email" maxLength={254} required className="snapink-draft-field" value={customerEmail} onChange={e => editOrder(setCustomerEmail, e.target.value)} />
                <input type="tel" placeholder="Phone (optional)" aria-label="Phone number (optional)" autoComplete="tel" maxLength={40} className="snapink-draft-field" value={customerPhone} onChange={e => editOrder(setCustomerPhone, e.target.value)} />
                <label className="snapink-draft-quantity grid gap-1 text-sm">Quantity
                  <input type="number" aria-label="Quantity" min={1} max={RETAIL_MAX_QUANTITY} step={1} required className="snapink-draft-field" value={quantity} onChange={e => { idempotencyKeyRef.current = null; setSubmitted(null); setQuantity(e.target.value === "" ? 0 : Number(e.target.value)); }} />
                </label>
              </div>
              <h3 className="snapink-retail-address-heading">SHIPPING ADDRESS</h3>
              <input type="text" placeholder="Street address" aria-label="Street address" autoComplete="address-line1" maxLength={150} required className="snapink-draft-field" value={line1} onChange={e => editOrder(setLine1, e.target.value)} />
              <input type="text" placeholder="Apartment, suite, etc. (optional)" aria-label="Apartment or unit (optional)" autoComplete="address-line2" maxLength={150} className="snapink-draft-field" value={line2} onChange={e => editOrder(setLine2, e.target.value)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <input type="text" placeholder="City" aria-label="City" autoComplete="address-level2" maxLength={100} required className="snapink-draft-field" value={city} onChange={e => editOrder(setCity, e.target.value)} />
                <input type="text" placeholder="State / province" aria-label="State or province" autoComplete="address-level1" maxLength={100} required className="snapink-draft-field" value={region} onChange={e => editOrder(setRegion, e.target.value)} />
                <input type="text" placeholder="ZIP / postal code" aria-label="ZIP or postal code" autoComplete="postal-code" maxLength={24} required className="snapink-draft-field" value={postalCode} onChange={e => editOrder(setPostalCode, e.target.value)} />
                <input type="text" placeholder="Country code (US)" aria-label="Two-letter country code" autoComplete="country" pattern="[A-Za-z]{2}" maxLength={2} required className="snapink-draft-field" value={country} onChange={e => editOrder(setCountry, e.target.value.toUpperCase())} />
              </div>
              <button type="submit" disabled={sending || !pricing} className="w-full rounded-full bg-si-button px-5 py-3 text-lg font-black text-neutral-950 hover:bg-si-hover disabled:opacity-50">
                {sending ? "PLACING ORDER…" : "PLACE MY CUSTOM ORDER"}
              </button>
              {error && <p className="text-center text-red-700" role="alert">{error}</p>}
              <p className="snapink-draft-disclaimer text-xs leading-5">No payment required yet. We'll confirm your design can be produced and email you a secure payment link.</p>
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
