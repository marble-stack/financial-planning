import { describe, it, expect } from 'vitest';
import {
  BUCKET_KEYS,
  mapYnabCategoryToBucket,
  toPercentages,
  summarizeYnabBudget,
} from '../lib/ynab-budget.js';

describe('mapYnabCategoryToBucket', () => {
  it('maps fixed obligations to fixedCosts', () => {
    expect(mapYnabCategoryToBucket('Rent')).toBe('fixedCosts');
    expect(mapYnabCategoryToBucket('Mortgage')).toBe('fixedCosts');
    expect(mapYnabCategoryToBucket('Electric Utility')).toBe('fixedCosts');
    expect(mapYnabCategoryToBucket('Car Payment')).toBe('fixedCosts');
    expect(mapYnabCategoryToBucket('Groceries')).toBe('fixedCosts');
    expect(mapYnabCategoryToBucket('Renters Insurance')).toBe('fixedCosts');
  });

  it('maps savings goals to shortTerm', () => {
    expect(mapYnabCategoryToBucket('Emergency Fund')).toBe('shortTerm');
    expect(mapYnabCategoryToBucket('Vacation')).toBe('shortTerm');
    expect(mapYnabCategoryToBucket('Rainy Day')).toBe('shortTerm');
    expect(mapYnabCategoryToBucket('Car Repair Sinking Fund')).toBe('shortTerm');
  });

  it('maps investments to longTerm', () => {
    expect(mapYnabCategoryToBucket('Roth IRA')).toBe('longTerm');
    expect(mapYnabCategoryToBucket('401k Contribution')).toBe('longTerm');
    expect(mapYnabCategoryToBucket('Brokerage')).toBe('longTerm');
    expect(mapYnabCategoryToBucket('Retirement Savings')).toBe('longTerm');
    expect(mapYnabCategoryToBucket('HSA')).toBe('longTerm');
  });

  it('maps unknown/discretionary categories to guiltFree', () => {
    expect(mapYnabCategoryToBucket('Dining Out')).toBe('guiltFree');
    expect(mapYnabCategoryToBucket('Hobbies')).toBe('guiltFree');
    expect(mapYnabCategoryToBucket('Video Games')).toBe('guiltFree');
    expect(mapYnabCategoryToBucket('')).toBe('guiltFree');
  });

  it('excludes income/inflow categories (returns null)', () => {
    expect(mapYnabCategoryToBucket('Inflow: Ready to Assign')).toBeNull();
    expect(mapYnabCategoryToBucket('Paycheck')).toBeNull();
    expect(mapYnabCategoryToBucket('To be Budgeted')).toBeNull();
  });

  it('uses the group name as a fallback signal', () => {
    expect(mapYnabCategoryToBucket('Acme Fund', 'Investments')).toBe('longTerm');
    expect(mapYnabCategoryToBucket('Beach Trip', 'Savings Goals')).toBe('shortTerm');
  });
});

describe('toPercentages', () => {
  it('returns all zeros when total is zero', () => {
    expect(toPercentages({ fixedCosts: 0, shortTerm: 0, longTerm: 0, guiltFree: 0 }, 0)).toEqual({
      fixedCosts: 0,
      shortTerm: 0,
      longTerm: 0,
      guiltFree: 0,
    });
  });

  it('computes proportional percentages that sum to 100', () => {
    const pct = toPercentages(
      { fixedCosts: 2000, shortTerm: 400, longTerm: 800, guiltFree: 800 },
      4000
    );
    expect(pct).toEqual({ fixedCosts: 50, shortTerm: 10, longTerm: 20, guiltFree: 20 });
  });

  it('always sums to exactly 100 even with rounding drift', () => {
    const pct = toPercentages(
      { fixedCosts: 100, shortTerm: 100, longTerm: 100, guiltFree: 100 },
      400
    );
    const sum = BUCKET_KEYS.reduce((s, k) => s + pct[k], 0);
    expect(sum).toBe(100);
  });

  it('handles a single non-zero bucket', () => {
    const pct = toPercentages({ fixedCosts: 1000, shortTerm: 0, longTerm: 0, guiltFree: 0 }, 1000);
    expect(pct).toEqual({ fixedCosts: 100, shortTerm: 0, longTerm: 0, guiltFree: 0 });
  });
});

describe('summarizeYnabBudget', () => {
  const sampleGroups = [
    {
      name: 'Immediate Obligations',
      categories: [
        { name: 'Rent', budgeted: 1500000 },
        { name: 'Groceries', budgeted: 500000 },
      ],
    },
    {
      name: 'Savings Goals',
      categories: [
        { name: 'Emergency Fund', budgeted: 400000 },
        { name: 'Roth IRA', budgeted: 600000 },
      ],
    },
    {
      name: 'Just for Fun',
      categories: [
        { name: 'Dining Out', budgeted: 300000 },
        { name: 'Entertainment', budgeted: 200000 },
      ],
    },
    {
      name: 'Internal Master Category',
      categories: [{ name: 'Inflow: Ready to Assign', budgeted: 5000000 }],
    },
  ];

  it('aggregates budgeted amounts into the correct buckets (milliunits -> dollars)', () => {
    const summary = summarizeYnabBudget(sampleGroups);
    expect(summary.buckets).toEqual({
      fixedCosts: 2000, // Rent + Groceries
      shortTerm: 400, // Emergency Fund
      longTerm: 600, // Roth IRA
      guiltFree: 500, // Dining + Entertainment
    });
    expect(summary.totalMonthly).toBe(3500);
  });

  it('excludes the Internal Master Category group (inflow)', () => {
    const summary = summarizeYnabBudget(sampleGroups);
    const hasInflow = summary.breakdown.some((b) => /ready to assign/i.test(b.name));
    expect(hasInflow).toBe(false);
  });

  it('produces percentages that sum to 100', () => {
    const summary = summarizeYnabBudget(sampleGroups);
    const sum = BUCKET_KEYS.reduce((s, k) => s + summary.percentages[k], 0);
    expect(sum).toBe(100);
  });

  it('skips deleted, hidden, and non-positive categories', () => {
    const groups = [
      {
        name: 'Mixed',
        categories: [
          { name: 'Rent', budgeted: 1000000 },
          { name: 'Deleted Cat', budgeted: 500000, deleted: true },
          { name: 'Hidden Cat', budgeted: 500000, hidden: true },
          { name: 'Unfunded', budgeted: 0 },
          { name: 'Overspent', budgeted: -100000 },
        ],
      },
    ];
    const summary = summarizeYnabBudget(groups);
    expect(summary.categoryCount).toBe(1);
    expect(summary.buckets.fixedCosts).toBe(1000);
  });

  it('skips deleted and hidden groups', () => {
    const groups = [
      { name: 'Gone', deleted: true, categories: [{ name: 'Rent', budgeted: 1000000 }] },
      { name: 'Secret', hidden: true, categories: [{ name: 'Rent', budgeted: 1000000 }] },
    ];
    const summary = summarizeYnabBudget(groups);
    expect(summary.totalMonthly).toBe(0);
    expect(summary.categoryCount).toBe(0);
  });

  it('handles empty or missing input gracefully', () => {
    expect(summarizeYnabBudget([]).totalMonthly).toBe(0);
    expect(summarizeYnabBudget(undefined).totalMonthly).toBe(0);
    expect(summarizeYnabBudget(null).percentages).toEqual({
      fixedCosts: 0,
      shortTerm: 0,
      longTerm: 0,
      guiltFree: 0,
    });
  });

  it('records a breakdown entry per included category', () => {
    const summary = summarizeYnabBudget(sampleGroups);
    expect(summary.categoryCount).toBe(6);
    expect(summary.breakdown[0]).toMatchObject({
      name: 'Rent',
      group: 'Immediate Obligations',
      bucket: 'fixedCosts',
      dollars: 1500,
    });
  });
});
