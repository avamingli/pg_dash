import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fourJoin from '../../../docs/samples/four-join.json';
import { deleteRecording, listRecordings } from '@/lib/recordingLibrary';
import Replay from './Replay';

// The panel itself is covered by ReplayPanel.test.tsx; here we only care
// that the page hands it a parsed recording (and refuses to when the
// file isn't one).
vi.mock('@/components/ReplayPanel', () => ({
  default: ({ recording }: { recording: { frames: unknown[] } }) => (
    <div data-testid="replay-panel">{recording.frames.length} frames loaded</div>
  ),
}));

function jsonFile(name: string, body: unknown) {
  return new File([typeof body === 'string' ? body : JSON.stringify(body)], name, { type: 'application/json' });
}

// The fake IndexedDB outlives each test, so start every one from empty.
beforeEach(async () => {
  for (const meta of await listRecordings()) await deleteRecording(meta.id);
});

describe('Replay page', () => {
  it('explains where recordings come from before one is loaded', () => {
    render(<Replay />);
    expect(screen.getByText(/Drop a plan-snapshot JSON here/)).toBeInTheDocument();
    expect(screen.queryByTestId('replay-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved recordings')).not.toBeInTheDocument();
  });

  it('plays a recording picked from the file input', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('four-join.json', fourJoin));
    expect(await screen.findByTestId('replay-panel')).toHaveTextContent('15 frames loaded');
    // The file name shows twice once it's saved (player caption + library
    // row); the caption is the one this test is about.
    expect(screen.getByText(/^Replaying/)).toHaveTextContent('four-join.json');
  });

  it('reports a file that is not a recording instead of rendering an empty player', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('notes.json', { hello: 'world' }));
    await waitFor(() => expect(screen.getByText(/Couldn't read that recording/)).toBeInTheDocument());
    expect(screen.getByText(/version undefined/)).toBeInTheDocument();
    expect(screen.queryByTestId('replay-panel')).not.toBeInTheDocument();
  });

  it('reports a truncated / non-JSON file', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('half.json', '{"version": 1, "frames": ['));
    await waitFor(() => expect(screen.getByText(/Couldn't read that recording/)).toBeInTheDocument());
  });

  it('keeps a loaded recording in the library without being asked', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('four-join.json', fourJoin));
    expect(await screen.findByText('Saved recordings')).toBeInTheDocument();
    await waitFor(async () => expect((await listRecordings()).map(m => m.fileName)).toEqual(['four-join.json']));
  });

  it('does not keep a file it refused to parse', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('notes.json', { hello: 'world' }));
    await waitFor(() => expect(screen.getByText(/Couldn't read that recording/)).toBeInTheDocument());
    expect(await listRecordings()).toEqual([]);
  });

  it('replays a saved recording from the library, with no file involved', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('four-join.json', fourJoin));
    await screen.findByText('Saved recordings');

    // A fresh mount has only the library — the File object is long gone.
    cleanup();
    const fresh = render(<Replay />);
    expect(await fresh.findByText('four-join.json')).toBeInTheDocument();
    expect(fresh.queryByTestId('replay-panel')).not.toBeInTheDocument();

    await userEvent.click(fresh.getByText('four-join.json'));
    expect(await fresh.findByTestId('replay-panel')).toHaveTextContent('15 frames loaded');
  });

  it('takes two clicks to remove an entry, and removes only our copy', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('four-join.json', fourJoin));
    await screen.findByText('Saved recordings');

    await userEvent.click(screen.getByLabelText('Remove four-join.json from the library'));
    await userEvent.click(screen.getByText('Cancel'));
    expect(await listRecordings()).toHaveLength(1);

    await userEvent.click(screen.getByLabelText('Remove four-join.json from the library'));
    await userEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(screen.queryByText('Saved recordings')).not.toBeInTheDocument());
    expect(await listRecordings()).toEqual([]);
    // The recording that was already playing is untouched by the removal
    // — as is the JSON file it came from, which we only ever copied.
    expect(screen.getByTestId('replay-panel')).toHaveTextContent('15 frames loaded');
  });
});
