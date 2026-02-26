/**
 * Currency utility functions for handling paise and rupees
 * All amounts stored in database as paise (integer) for precision
 * Only converted to rupees for display purposes
 */

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function formatCurrency(amount: number, currency: 'paise' | 'rupees' = 'rupees'): string {
  const value = currency === 'paise' ? paiseToRupees(amount) : amount;
  // Format with comma separation and round to 0 decimal places
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

// Validate if a paise value is a valid integer
export function isValidPaiseValue(paise: any): boolean {
  return Number.isInteger(paise) && paise >= 0;
}

// Validate if a rupee value is valid
export function isValidRupeeValue(rupees: any): boolean {
  return typeof rupees === 'number' && !isNaN(rupees) && rupees >= 0;
}