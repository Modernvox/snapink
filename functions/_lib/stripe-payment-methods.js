export const SNAPINK_STRIPE_PAYMENT_METHODS = Object.freeze(["card", "cashapp"]);

export function setSnapInkCheckoutPaymentMethods(form) {
  SNAPINK_STRIPE_PAYMENT_METHODS.forEach((method, index) => {
    form.set(`payment_method_types[${index}]`, method);
  });
}
