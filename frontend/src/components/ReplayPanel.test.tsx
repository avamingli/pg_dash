import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import fourJoin from '../../../docs/samples/four-join.json';
import { parseRecording } from '@/lib/replayEngine';
import ReplayPanel from './ReplayPanel';

// Stand in for the plan view: what matters here is *which* frame's state
// the panel hands over, not how the graph draws it (PlanPlayer's own
// pipeline output is covered end-to-end in lib/replay.test.ts).
// The stand-in can also surface the `transport` prop the way PlanGraph's
// fullscreen overlay does — opt-in per test, since a second copy of the
// controls would make every getByTitle above ambiguous.
const mock = vi.hoisted(() => ({ renderTransport: false }));
vi.mock('@/components/PlanPlayer', () => ({
  default: ({ runTimeMs, memoryMb, finished, transport }: { runTimeMs: number; memoryMb: number | null; finished: boolean; transport?: React.ReactNode }) => (
    <div data-testid="plan-player" data-runtime={runTimeMs} data-memory={String(memoryMb)} data-finished={String(finished)}>
      {mock.renderTransport && <div data-testid="fullscreen-transport">{transport}</div>}
    </div>
  ),
}));

const recording = parseRecording(fourJoin);
const shownRunTime = () => Number(screen.getByTestId('plan-player').getAttribute('data-runtime'));

// Each frame arms the next one's timer only after React commits, so a
// single big timer advance would still land one frame on. Step frame by
// frame instead: `waitMs` is what the panel should be waiting at the
// current speed (the sample's frames are a flat 900ms apart).
function play(frames: number, waitMs = 900) {
  for (let i = 0; i < frames; i++) act(() => { vi.advanceTimersByTime(waitMs); });
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { vi.useRealTimers(); mock.renderTransport = false; });

describe('ReplayPanel', () => {
  it('starts at the first frame and shows the recording metadata', () => {
    render(<ReplayPanel recording={recording} />);
    expect(screen.getByText(/Frame 1\/15/)).toBeInTheDocument();
    expect(shownRunTime()).toBe(0);
    expect(screen.getByText(/15 frames · 12.6s/)).toBeInTheDocument();
    expect(screen.getByText(/cloudberry · 3 segments/)).toBeInTheDocument();
  });

  it('advances one frame per recorded gap while playing', () => {
    render(<ReplayPanel recording={recording} />);
    play(1);
    expect(screen.getByText(/Frame 2\/15/)).toBeInTheDocument();
    expect(shownRunTime()).toBe(900);
    play(2);
    expect(shownRunTime()).toBe(2700);
  });

  it('pauses and resumes from where it stopped', () => {
    render(<ReplayPanel recording={recording} />);
    play(1);
    fireEvent.click(screen.getByTitle('Pause'));
    play(5);
    expect(shownRunTime()).toBe(900);
    fireEvent.click(screen.getByTitle('Play'));
    play(1);
    expect(shownRunTime()).toBe(1800);
  });

  it('divides each gap by the selected speed', () => {
    render(<ReplayPanel recording={recording} />);
    fireEvent.click(screen.getByTitle('4x the recorded cadence'));
    // 900ms of recorded gap now takes 225ms of playback.
    play(4, 225);
    expect(shownRunTime()).toBe(3600);
    // …and not a millisecond less: at 1x the same wait moves one frame.
    fireEvent.click(screen.getByTitle('Real time — the cadence the run was captured at'));
    play(1, 225);
    expect(shownRunTime()).toBe(3600);
    play(1, 675);
    expect(shownRunTime()).toBe(4500);
  });

  it('scrubs to an arbitrary frame and stops playback there', () => {
    render(<ReplayPanel recording={recording} />);
    fireEvent.change(screen.getByLabelText('Playback position'), { target: { value: '12' } });
    expect(screen.getByText(/Frame 13\/15/)).toBeInTheDocument();
    expect(shownRunTime()).toBe(10800);
    play(5);
    expect(shownRunTime()).toBe(10800);
  });

  it('offers a rewind once playback reaches the end', () => {
    render(<ReplayPanel recording={recording} />);
    play(14);
    expect(screen.getByText(/Frame 15\/15/)).toBeInTheDocument();
    // The sample was stopped mid-query, so its last frame is not "finished".
    expect(screen.getByTestId('plan-player').getAttribute('data-finished')).toBe('false');
    fireEvent.click(screen.getByTitle('Replay from the start'));
    expect(shownRunTime()).toBe(0);
  });

  it('restarts from the first frame mid-playback', () => {
    render(<ReplayPanel recording={recording} />);
    play(3);
    expect(shownRunTime()).toBe(2700);
    fireEvent.click(screen.getByTitle('Back to the first frame'));
    expect(shownRunTime()).toBe(0);
  });

  it('hands the same transport to the plan view, so fullscreen can pause and restart', () => {
    // Fullscreen is a portal outside the panel: the controls it shows are
    // this second copy, driven by the same state as the panel's own bar.
    mock.renderTransport = true;
    render(<ReplayPanel recording={recording} />);
    const fullscreen = within(screen.getByTestId('fullscreen-transport'));
    play(2);
    fireEvent.click(fullscreen.getByTitle('Pause'));
    play(5);
    expect(shownRunTime()).toBe(1800);
    expect(screen.getAllByTitle('Play')).toHaveLength(2);  // both copies agree
    fireEvent.click(fullscreen.getByTitle('Back to the first frame'));
    expect(shownRunTime()).toBe(0);
    play(1);
    expect(shownRunTime()).toBe(900);  // restart also resumes playback
  });
});
