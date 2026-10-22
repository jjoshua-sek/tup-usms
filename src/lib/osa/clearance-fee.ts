/**
 * Which clearances carry a fee paid at the Cashier (OSA checklist G3, as
 * the team settled it: the Good Moral certificate only). Graduation,
 * transfer and general clearances go from cleared straight to ready.
 */
export const FEE_REQUEST_TYPES: ReadonlySet<string> = new Set(["good_moral"]);

export function clearanceHasFee(requestType: string): boolean {
  return FEE_REQUEST_TYPES.has(requestType);
}
