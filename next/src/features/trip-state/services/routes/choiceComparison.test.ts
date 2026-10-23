import { describe, expect, it } from 'vitest';
import { createHandlers, type Gateway, type TripRow } from '../handlers';

const row: TripRow = { client_id: 'trip', revision: 2, updated_at: '', deleted_at: null, role: 'OWNER', data: {
  start: '2026-10-16', timeZone: 'Asia/Seoul', days: [{ mode: 'walk', spots: [
    { name: '출발지', lat: 37, lng: 127 }, { name: '미술관', lat: 37.01, lng: 127.01, at: '14:00',
      choice: { version: 1, state: 'PENDING', alternative: { name: '강변', lat: 37.1, lng: 127.1 } } }
  ] }] } };
let writes = 0;
const gateway = { async getTrip() { return structuredClone(row); }, async saveTrip() { writes++; throw Error('preview cannot write'); } } as unknown as Gateway;
const handlers = createHandlers({ gatewayFor: token => token === 'ok' ? gateway : null, now: () => new Date('2026-10-16T00:00:00Z') });
const request = (body: unknown, token = 'ok') => new Request('https://example.test/choice-comparison', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
});
describe('choice comparison is an authenticated, revision-bound read', () => {
  it('compares both actual paths with explicit estimate sources and leaves the document untouched', async () => {
    const before = JSON.stringify(row); writes = 0;
    const response = await handlers.choiceComparison(request({ expectedRevision: 2, activityId: 'd0s1' }), 'trip');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices.map((option: { travel: { source: string } }) => option.travel.source)).toEqual(['STRAIGHT_LINE_ESTIMATE', 'STRAIGHT_LINE_ESTIMATE']);
    expect(body.choices[1].travel.minutes).toBeGreaterThan(body.choices[0].travel.minutes);
    expect(writes).toBe(0); expect(JSON.stringify(row)).toBe(before);
  });
  it('rejects missing auth, obsolete revisions, invalid IDs and slots without a choice', async () => {
    for (const [body, token, expected] of [
      [{ expectedRevision: 2, activityId: 'd0s1' }, 'bad', 401],
      [{ expectedRevision: 1, activityId: 'd0s1' }, 'ok', 409],
      [{ expectedRevision: 2, activityId: 'd0s0' }, 'ok', 409],
      [{ expectedRevision: 2, activityId: 'd-1s0' }, 'ok', 400]
    ] as const) expect((await handlers.choiceComparison(request(body, token), 'trip')).status).toBe(expected);
  });
});
