// POST   /api/v1/devices              기기 등록 (push token)
// DELETE /api/v1/devices?deviceId=…   로그아웃·알림 끄기
import { handlers } from '../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handlers.registerDevice(request);
}

export async function DELETE(request: Request) {
  return handlers.unregisterDevice(request);
}
