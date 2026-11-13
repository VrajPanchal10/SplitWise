export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  flag: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham', flag: '🇦🇪' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
];

export const DEFAULT_CURRENCY = 'INR';

// Reference USD base rates (1 USD = X target)
const USD_BASE_RATES: { [key: string]: number } = {
  USD: 1.0,
  INR: 86.5,
  EUR: 0.92,
  GBP: 0.78,
  CAD: 1.38,
  AUD: 1.52,
  SGD: 1.34,
  AED: 3.67,
  JPY: 152.0,
};

export function getCurrencySymbol(code?: string): string {
  if (!code) return '₹';
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code.toUpperCase().trim());
  return found ? found.symbol : code + ' ';
}

export function getCurrencyConfig(code?: string): CurrencyConfig {
  const norm = (code || DEFAULT_CURRENCY).toUpperCase().trim();
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === norm);
  return found || { code: norm, symbol: norm + ' ', name: norm, flag: '🌐' };
}

export function getApproximateRate(fromCode: string, toCode: string): number {
  const from = (fromCode || DEFAULT_CURRENCY).toUpperCase().trim();
  const to = (toCode || DEFAULT_CURRENCY).toUpperCase().trim();
  if (from === to) return 1.0;
  const fromRate = USD_BASE_RATES[from] || 1.0;
  const toRate = USD_BASE_RATES[to] || 1.0;
  return Math.round((toRate / fromRate) * 10000) / 10000;
}

export function formatMoney(amount: number | string | null | undefined, currencyCode?: string, showCode: boolean = false): string {
  const num = typeof amount === 'number' ? amount : parseFloat(amount || '0') || 0;
  const code = (currencyCode || DEFAULT_CURRENCY).toUpperCase().trim();
  const symbol = getCurrencySymbol(code);
  const formattedNum = num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (showCode) {
    return `${symbol}${formattedNum} ${code}`;
  }
  return `${symbol}${formattedNum}`;
}

export function formatDualCurrency(
  originalAmount: number | null | undefined,
  originalCurrency: string = 'INR',
  convertedAmount?: number | null,
  baseCurrency: string = 'INR',
  exchangeRate?: number | null
): { primary: string; secondary?: string; rateInfo?: string } {
  const origAmt = originalAmount || 0;
  const origCurr = (originalCurrency || DEFAULT_CURRENCY).toUpperCase().trim();
  const targetCurr = (baseCurrency || DEFAULT_CURRENCY).toUpperCase().trim();

  const primary = formatMoney(origAmt, origCurr, true);

  if (origCurr !== targetCurr && (convertedAmount != null || exchangeRate != null)) {
    const convAmt = convertedAmount != null ? convertedAmount : origAmt * (exchangeRate || getApproximateRate(origCurr, targetCurr));
    const secondary = `≈ ${formatMoney(convAmt, targetCurr, true)}`;
    const rate = exchangeRate || getApproximateRate(origCurr, targetCurr);
    const rateInfo = `(1 ${origCurr} = ${rate} ${targetCurr})`;
    return { primary, secondary, rateInfo };
  }

  return { primary };
}
