export const DISPLAY_CURRENCIES = [
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "PHP", label: "Philippine Peso", symbol: "₱" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "CAD", label: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "MXN", label: "Mexican Peso", symbol: "MX$" },
  { code: "BRL", label: "Brazilian Real", symbol: "R$" },
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]["code"];

export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return (
    typeof value === "string" &&
    DISPLAY_CURRENCIES.some((currency) => currency.code === value)
  );
}

export function formatCurrency(
  amount: number,
  currency: DisplayCurrency,
): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(amount);
}
