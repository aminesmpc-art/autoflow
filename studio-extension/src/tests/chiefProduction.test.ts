import { readContracts, readReview } from '../studio/ask/chiefProduction';
import type { ChiefDirector } from '../studio/ask/chief';

const directors: ChiefDirector[] = [
  { id: 'a', label: 'A', targets: [{ id: 'one', label: 'One', media: 'video', duration: '4s' }] },
  { id: 'b', label: 'B', targets: [{ id: 'two', label: 'Two', media: 'video', duration: '4s' }] },
] as ChiefDirector[];
const contracts = () => [
  { targetId: 'one', opening: 'Empty room', action: 'Enter', ending: 'At door', voiceover: 'Choose carefully.', continuesFrom: null },
  { targetId: 'two', opening: 'At door', action: 'Point', ending: 'At door', voiceover: '', continuesFrom: 'one' },
];

describe('Chief scene contracts', () => {
  it('accepts a complete cross-Director handoff', () => {
    expect(readContracts(JSON.stringify({ contracts: contracts() }), directors)).toHaveLength(2);
  });
  it.each(['missing', 'duplicate', 'unknown', 'handoff', 'cycle', 'long voice', 'missing voice'])('rejects %s contracts', kind => {
    const rows: any[] = contracts();
    if (kind === 'missing') rows.pop();
    if (kind === 'duplicate') rows[1].targetId = 'one';
    if (kind === 'unknown') rows[1].targetId = 'absent';
    if (kind === 'handoff') rows[1].opening = 'Elsewhere';
    if (kind === 'cycle') { rows[0].continuesFrom = 'two'; rows[0].opening = 'At door'; }
    if (kind === 'long voice') rows[0].voiceover = 'word '.repeat(50);
    if (kind === 'missing voice') delete rows[0].voiceover;
    expect(() => readContracts(JSON.stringify({ contracts: rows }), directors)).toThrow();
  });
  it('rejects spoken dialogue on reference stills', () => {
    const stills = [{ ...directors[0], targets: [{ ...directors[0].targets[0], media: 'image' as const }] }, directors[1]];
    expect(() => readContracts(JSON.stringify({ contracts: contracts() }), stills)).toThrow(/silent/);
  });
});

describe('Chief review fails closed', () => {
  it.each([
    '{}', '{"approved":true,"issues":[{"targetId":"one","problem":"Wrong room"}]}',
    '{"approved":false,"issues":[]}', '{"approved":false,"issues":[{"targetId":"unknown","problem":"Wrong room"}]}',
  ])('rejects malformed or contradictory approval: %s', reply => {
    expect(() => readReview(reply, directors)).toThrow();
  });
  it('accepts explicit approval', () => expect(readReview('{"approved":true,"issues":[]}', directors)).toEqual([]));
  it('returns the exact target needing repair', () => {
    expect(readReview('{"approved":false,"issues":[{"targetId":"two","problem":"Wrong room"}]}', directors))
      .toEqual([{ targetId: 'two', problem: 'Wrong room' }]);
  });
});
