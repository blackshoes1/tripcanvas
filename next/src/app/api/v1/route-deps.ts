// /api/v1 라우트가 공유하는 실제 의존성. 테스트는 createHandlers에 가짜 Gateway를 넣어 이 파일을 거치지 않는다.
import { createHandlers } from '@/features/trip-state/services/handlers';
import { supabaseGatewayFor } from '@/features/trip-state/services/supabaseGateway';

export const handlers = createHandlers({ gatewayFor: supabaseGatewayFor });
