import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fourJoin from '../../../docs/samples/four-join.json';
import { deleteRecordings, listRecordings } from '@/lib/recordingLibrary';
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
  await deleteRecordings((await listRecordings()).map(m => m.id));
});

/** Load `names` one after another; the last one loaded is playing when this returns. */
async function loadAll(names: string[]) {
  for (const name of names) {
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile(name, fourJoin));
    await screen.findByLabelText(`Select ${name}`);
  }
}
const rowOf = (name: string) => screen.getByLabelText(`Select ${name}`).closest('li')!;
const rowNames = () => screen.getAllByLabelText(/^Select .*\.json$/).map(el => el.getAttribute('aria-label')!.slice('Select '.length));
// jsdom has no DataTransfer; the handlers only touch these three members.
const dataTransfer = { effectAllowed: '', setData: () => {}, types: [] as string[] };

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

  it('replays a saved recording from the library via its Play button, with no file involved', async () => {
    render(<Replay />);
    await loadAll(['four-join.json']);

    // A fresh mount has only the library — the File object is long gone.
    cleanup();
    const fresh = render(<Replay />);
    expect(await fresh.findByText('four-join.json')).toBeInTheDocument();
    expect(fresh.queryByTestId('replay-panel')).not.toBeInTheDocument();

    // Clicking the row only selects it; playing is an explicit button.
    await userEvent.click(fresh.getByText('four-join.json'));
    expect(fresh.queryByTestId('replay-panel')).not.toBeInTheDocument();
    expect(fresh.getByLabelText('Select four-join.json')).toBeChecked();

    await userEvent.click(fresh.getByLabelText('Play four-join.json'));
    expect(await fresh.findByTestId('replay-panel')).toHaveTextContent('15 frames loaded');
  });

  it('closes the player and returns to the drop zone', async () => {
    render(<Replay />);
    await loadAll(['four-join.json']);
    expect(screen.getByTestId('replay-panel')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Close replay'));
    expect(screen.queryByTestId('replay-panel')).not.toBeInTheDocument();
    expect(screen.getByText(/Drop a plan-snapshot JSON here/)).toBeInTheDocument();
    // Closing the player is not removing the recording.
    expect(screen.getByLabelText('Play four-join.json')).toBeInTheDocument();
  });

  it('asks in a dialog before removing, and removes only our copy', async () => {
    render(<Replay />);
    await loadAll(['four-join.json']);

    await userEvent.click(screen.getByLabelText('Remove four-join.json from the library'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Remove “four-join.json” from the library?');
    await userEvent.click(within(dialog).getByText('Cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await listRecordings()).toHaveLength(1);

    await userEvent.click(screen.getByLabelText('Remove four-join.json from the library'));
    await userEvent.click(within(screen.getByRole('dialog')).getByText('Remove'));
    await waitFor(() => expect(screen.queryByText('Saved recordings')).not.toBeInTheDocument());
    expect(await listRecordings()).toEqual([]);
    // The recording that was already playing is untouched by the removal
    // — as is the JSON file it came from, which we only ever copied.
    expect(screen.getByTestId('replay-panel')).toHaveTextContent('15 frames loaded');
  });

  it('cancels the dialog on Escape', async () => {
    render(<Replay />);
    await loadAll(['four-join.json']);
    await userEvent.click(screen.getByLabelText('Remove four-join.json from the library'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await listRecordings()).toHaveLength(1);
  });

  it('removes a ticked batch in one go and leaves the rest', async () => {
    render(<Replay />);
    await loadAll(['a.json', 'b.json', 'c.json']);

    await userEvent.click(screen.getByLabelText('Select a.json'));
    await userEvent.click(screen.getByLabelText('Select c.json'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Remove selected'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Remove 2 recordings from the library?');
    expect(dialog).toHaveTextContent('a.json');
    expect(dialog).toHaveTextContent('c.json');
    await userEvent.click(within(dialog).getByText('Remove'));

    await waitFor(() => expect(rowNames()).toEqual(['b.json']));
    expect((await listRecordings()).map(m => m.fileName)).toEqual(['b.json']);
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('selects and clears everything from the header checkbox', async () => {
    render(<Replay />);
    await loadAll(['a.json', 'b.json']);
    await userEvent.click(screen.getByLabelText('Select all recordings'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Select a.json')).toBeChecked();
    await userEvent.click(screen.getByLabelText('Select all recordings'));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('reorders by drag and remembers the order', async () => {
    render(<Replay />);
    await loadAll(['a.json', 'b.json', 'c.json']);
    expect(rowNames()).toEqual(['c.json', 'b.json', 'a.json']); // newest on top

    // Drag the bottom row over the top one.
    fireEvent.dragStart(rowOf('a.json'), { dataTransfer });
    fireEvent.dragOver(rowOf('c.json'), { dataTransfer });
    expect(rowNames()).toEqual(['a.json', 'c.json', 'b.json']); // live, before the drop
    fireEvent.dragEnd(rowOf('a.json'), { dataTransfer });

    await waitFor(async () => expect((await listRecordings()).map(m => m.fileName)).toEqual(['a.json', 'c.json', 'b.json']));

    // The order survives a reload of the page.
    cleanup();
    const fresh = render(<Replay />);
    await fresh.findByLabelText('Select a.json');
    expect(rowNames()).toEqual(['a.json', 'c.json', 'b.json']);
  });
});
