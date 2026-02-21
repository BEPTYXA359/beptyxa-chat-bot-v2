import { z } from 'zod';

const SteamSubSchema = z.object({
  option_text: z.string(),
  price_in_cents_with_discount: z.number(),
});

const SteamGameDetailsSchema = z.object({
  name: z.string(),
  is_free: z.boolean(),
  package_groups: z
    .array(
      z.object({
        subs: z.array(SteamSubSchema),
      }),
    )
    .optional()
    .default([]),
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
