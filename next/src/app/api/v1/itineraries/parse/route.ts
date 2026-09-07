// POST /api/v1/itineraries/parse — 붙여넣은 일정 글 읽기. 로직은 server/api/itineraryRoutes.ts.
import { itineraryRoutes } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return itineraryRoutes.parse(request);
}
