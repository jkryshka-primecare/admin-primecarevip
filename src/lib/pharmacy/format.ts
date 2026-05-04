/**
 * Format a monetary value with smart decimal precision:
 * minimum 2 decimals, up to 4 when needed, trailing zeros trimmed beyond 2.
 *
 * Examples:
 *   formatPrice(0.2)    => "0.20"
 *   formatPrice(0.32)   => "0.32"
 *   formatPrice(0.0123) => "0.0123"
 *   formatPrice(0.05)   => "0.05"
 *   formatPrice(0.0500) => "0.05"
 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  const fixed4 = value.toFixed(4);
  const trimmed = fixed4.replace(/0+$/, "").replace(/\.$/, "");
  const decimals = trimmed.includes(".") ? trimmed.split(".")[1].length : 0;
  return value.toFixed(Math.max(2, decimals));
}
