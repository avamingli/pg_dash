import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fourJoin from '../../../docs/samples/four-join.json';
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

describe('Replay page', () => {
  it('explains where recordings come from before one is loaded', () => {
    render(<Replay />);
    expect(screen.getByText(/Drop a plan-snapshot JSON here/)).toBeInTheDocument();
    expect(screen.queryByTestId('replay-panel')).not.toBeInTheDocument();
  });

  it('plays a recording picked from the file input', async () => {
    render(<Replay />);
    await userEvent.upload(screen.getByLabelText('Load recording'), jsonFile('four-join.json', fourJoin));
    expect(await screen.findByTestId('replay-panel')).toHaveTextContent('15 frames loaded');
    expect(screen.getByText('four-join.json')).toBeInTheDocument();
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
});
