/** Next가 새 Node 서버를 준비할 때 한 번 호출한다. Edge 번들에는 Node/APNs 모듈을 넣지 않는다. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLiveActivityWorker } = await import('./server/live-activities/runtime');
    startLiveActivityWorker();
  }
}
