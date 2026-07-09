/** CAD display formatting (user-confirmed). Storage is plain numeric; this is presentation only. */

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const cadCents = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,234" — for dashboards and large figures. */
export function money(amount: number): string {
  return cad.format(amount);
}

/** "$12.50" — for transaction rows where cents matter. */
export function moneyExact(amount: number): string {
  return cadCents.format(amount);
}

/** "+$120" / "−$45" with sign, for deltas. */
export function moneyDelta(amount: number): string {
  const formatted = cad.format(Math.abs(amount));
  return amount >= 0 ? `+${formatted}` : `−${formatted}`;
}
