import { describe, expect, it } from 'vitest';
import { SteamBrowseResponseSchema } from './steam.types';

const getItemsFixture = {
  response: {
    store_items: [
      {
        success: 1,
        purchase_options: [
          {
            packageid: 2481,
            purchase_option_name: 'Left 4 Dead 2',
            final_price_in_cents: '290000',
          },
          {
            bundleid: 233,
            purchase_option_name: 'Left 4 Dead Bundle',
            final_price_in_cents: '435000',
            bundle_discount_pct: 25,
            price_before_bundle_discount: '580000',
            included_game_count: 2,
          },
        ],
      },
    ],
  },
};

describe('SteamBrowseResponseSchema', () => {
  it('парсит ответ GetItems и приводит цены из строк в числа', () => {
    const parsed = SteamBrowseResponseSchema.parse(getItemsFixture);
    const options = parsed.response.store_items[0].purchase_options;

    expect(options[1].bundleid).toBe(233);
    expect(options[1].final_price_in_cents).toBe(435000);
    expect(options[1].price_before_bundle_discount).toBe(580000);
  });

  it('допускает опции без цены и без имени бандла', () => {
    const parsed = SteamBrowseResponseSchema.parse({
      response: { store_items: [{ success: 1, purchase_options: [{ bundleid: 1 }] }] },
    });

    expect(parsed.response.store_items[0].purchase_options[0].final_price_in_cents).toBeUndefined();
    expect(parsed.response.store_items[0].purchase_options[0].purchase_option_name).toBeUndefined();
  });

  it('подставляет пустой список purchase_options, если его нет', () => {
    const parsed = SteamBrowseResponseSchema.parse({
      response: { store_items: [{ success: 1 }] },
    });

    expect(parsed.response.store_items[0].purchase_options).toEqual([]);
  });
});
