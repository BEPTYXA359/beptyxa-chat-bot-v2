import { z } from 'zod';

const SteamSubSchema = z.object({
  option_text: z.string(),
  price_in_cents_with_discount: z.number(),
  price_in_cents: z.number().optional(),
  percent_savings: z.number().optional(),
  is_free_license: z.boolean().optional(),
});

const SteamPriceOverviewSchema = z.object({
  currency: z.string(),
  initial: z.number(),
  final: z.number(),
  discount_percent: z.number(),
});

const SteamReleaseDateSchema = z.object({
  coming_soon: z.boolean(),
  date: z.string(),
});

const SteamPackageGroupSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  subs: z.array(SteamSubSchema),
});

const SteamGameDetailsSchema = z.object({
  name: z.string(),
  is_free: z.boolean(),
  header_image: z.string().optional(),
  price_overview: SteamPriceOverviewSchema.optional(),
  release_date: SteamReleaseDateSchema.optional(),
  supported_languages: z.string().optional(),
  package_groups: z.array(SteamPackageGroupSchema).optional().default([]),
  dlc: z.array(z.number()).optional().default([]),
});

export const SteamApiResponseSchema = z.record(
  z.string(),
  z.object({
    success: z.boolean(),
    data: SteamGameDetailsSchema.optional(),
  }),
);

export type SteamApiResponse = z.infer<typeof SteamApiResponseSchema>;
export type SteamGameDetails = z.infer<typeof SteamGameDetailsSchema>;

export const REQUEST_DELAY_MS = 1000;

export interface EditionInfo {
  name: string;
  originalPriceKzt: number | null;
  finalPriceKzt: number;
  discountPercent: number | null;
  finalPriceRub: number;
  isFree: boolean;
}
