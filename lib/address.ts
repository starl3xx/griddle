/**
 * Shared Ethereum address validation. Used by every API route that
 * accepts a wallet address from the client. Single source of truth so a
 * future fix (e.g., adding EIP-55 checksum validation) only needs to
 * change here.
 */
export function isValidAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}
