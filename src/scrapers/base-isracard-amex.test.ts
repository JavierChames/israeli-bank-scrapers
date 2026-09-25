import moment from 'moment';
import { type Page } from 'puppeteer';
import { fetchGetWithinPage } from '../helpers/fetch';
import { TransactionStatuses, TransactionTypes } from '../transactions';
import { getAdditionalTransactionInformation, parseCardListBalances } from './base-isracard-amex';
import { CompanyTypes } from '../definitions';

jest.mock('../helpers/fetch', () => ({
  ...jest.requireActual('../helpers/fetch'),
  fetchGetWithinPage: jest.fn(),
}));
jest.mock('../helpers/waiting', () => ({
  ...jest.requireActual('../helpers/waiting'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

describe('parseCardListBalances', () => {
  test('parses card balance, balance date, and credit frame from the card-list page', () => {
    const balances = parseCardListBalances(`
      עבור כרטיס שמסתיים ב7392
      ניצלת עד כה 9,564.99 מתוך מסגרת האשראי 15,500 נכון לתאריך 10/08/2026
    `);

    expect(balances.get('7392')).toEqual({
      balance: -9564.99,
      balanceDate: '2026-08-10T00:00:00',
      cardFrame: 15500,
    });
  });

  test('skips card sections without a complete balance', () => {
    const balances = parseCardListBalances('עבור כרטיס שמסתיים ב7392');

    expect(balances.size).toBe(0);
  });

  test('derives an Isracard card balance from its credit frame and remaining credit', () => {
    const balances = parseCardListBalances(`
      מסטרקארד
      7392
      ₪9,564.99 לחיוב ב-10.08
      מסגרת: ₪15,500
      נותר לניצול: ₪5,935.01
    `);

    expect(balances.get('7392')).toEqual({
      balance: -9564.99,
      balanceDate: '2026-08-10T00:00:00',
      cardFrame: 15500,
    });
  });

  test('parses an Isracard card without a displayed billing date', () => {
    const balances = parseCardListBalances(`
      מסטרקארד
      7392 מבוטל
      מסגרת: ₪15,500
      נותר לניצול: ₪15,500
    `);

    expect(balances.get('7392')).toEqual({
      balance: 0,
      cardFrame: 15500,
    });
  });

  test('uses a single displayed Isracard billing date for cards without one', () => {
    const balances = parseCardListBalances(`
      מסטרקארד
      7392
      ₪9,564.99 לחיוב ב-10.09
      מסגרת: ₪15,500
      נותר לניצול: ₪5,935.01
      1234
      מסגרת: ₪5,000
      נותר לניצול: ₪4,328.00
    `);

    expect(balances.get('1234')).toEqual({
      balance: -672,
      balanceDate: '2026-09-10T00:00:00',
      cardFrame: 5000,
    });
  });

  test('does not use a shared Isracard billing date for a zero-frame card', () => {
    const balances = parseCardListBalances(`
      מסטרקארד
      7392
      ₪9,564.99 לחיוב ב-10.09
      מסגרת: ₪15,500
      נותר לניצול: ₪5,935.01
      1234 מבוטל
      מסגרת: ₪0
      נותר לניצול: ₪0.00
    `);

    expect(balances.get('1234')).toEqual({
      balance: 0,
      cardFrame: 0,
    });
  });
});

describe('getAdditionalTransactionInformation', () => {
  const txn = (identifier: number) => ({
    type: TransactionTypes.Normal,
    identifier,
    date: '2026-09-01T00:00:00.000Z',
    processedDate: '2026-10-02T00:00:00.000Z',
    originalAmount: -10,
    originalCurrency: 'ILS',
    chargedAmount: -10,
    description: `merchant ${identifier}`,
    status: TransactionStatuses.Completed,
  });
  const accounts = [{ '1234': { accountNumber: '1234', index: 0, txns: [txn(1), txn(2)] } }];
  const serviceOptions = { servicesUrl: 'https://example.test/services', companyCode: '11', cardListPageUrl: '' };

  beforeEach(() => {
    (fetchGetWithinPage as jest.Mock).mockReset().mockResolvedValue({ PirteyIska_204Bean: { sector: 'Food ' } });
  });

  test('skips detail requests for transactions listed in additionalTransactionInformationSkipIds', async () => {
    const [result] = await getAdditionalTransactionInformation(
      {
        companyId: CompanyTypes.isracard,
        startDate: new Date('2026-09-01'),
        additionalTransactionInformation: true,
        additionalTransactionInformationSkipIds: ['1'],
      },
      accounts,
      {} as Page,
      serviceOptions,
      [moment('2026-09-01')],
    );

    expect(fetchGetWithinPage).toHaveBeenCalledTimes(1);
    expect((fetchGetWithinPage as jest.Mock).mock.calls[0][1]).toContain('shovarRatz=2');
    expect(result['1234'].txns[0].category).toBeUndefined();
    expect(result['1234'].txns[1].category).toBe('Food');
  });

  test('requests details for every transaction when no skip list is given', async () => {
    await getAdditionalTransactionInformation(
      { companyId: CompanyTypes.isracard, startDate: new Date('2026-09-01'), additionalTransactionInformation: true },
      accounts,
      {} as Page,
      serviceOptions,
      [moment('2026-09-01')],
    );

    expect(fetchGetWithinPage).toHaveBeenCalledTimes(2);
  });
});
