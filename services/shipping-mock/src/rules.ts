/**
 * The mock's fixed rules (design §14, seed data and fault triggers).
 * - An address with postcode 0000 or a street with "Nowhere" does not resolve (Nora).
 * - Postcodes 0800–0899 (Northern Territory) are remote: the fee is higher than the default in an offer (Leo).
 * - No courier takes the kettle (courier_unavailable).
 */
export type Address = { line1: string; city: string; postcode: string };

export const FEES = { metro: 1000, remote: 2500 } as const;
export const NO_COURIER_SKUS = (process.env.NO_COURIER_SKUS ?? "kettle")
  .split(",")
  .map((s) => s.trim());

export function geocode(
  address: Address,
): { resolved: false } | { resolved: true; zone: keyof typeof FEES } {
  if (
    !/^\d{4}$/.test(address.postcode) ||
    address.postcode === "0000" ||
    /nowhere/i.test(address.line1)
  ) {
    return { resolved: false };
  }
  return { resolved: true, zone: address.postcode.startsWith("08") ? "remote" : "metro" };
}
