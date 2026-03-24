export function formatPesoAmount(value: number): string {
  const [intPart, decPart] = value.toFixed(2).split(".");
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₱${withSeparators}.${decPart}`;
}
