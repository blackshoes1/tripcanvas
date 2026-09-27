import { z } from 'zod';

/** 사진·만료 URL 대신 장소 식별자와 사용자가 고른 구도만 보관한다. */
export const PlaceCoverSchema = z.object({
  placeId: z.string().min(5).max(200).regex(/^[A-Za-z0-9_-]+$/),
  zoom: z.number().min(1).max(4),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1)
});
export type PlaceCover = z.infer<typeof PlaceCoverSchema>;
