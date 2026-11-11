/** The mock bank (design §14): the card reference decides the result. No random faults. */
export type BankResult = "approved" | "declined" | "unknown";

export function bank(cardRef: string): BankResult {
  if (cardRef === "card-decline") return "declined";
  if (cardRef.endsWith("-unknown")) return "unknown";
  return "approved";
}
