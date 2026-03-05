import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import Login from './Login';

// Mock the AuthContext
const mockLogin = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    token: null,
    user: null,
    isAuthenticated: false,
    isLoading: false,
    authRequired: true,
    logout: vi.fn(),
  }),
}));

function renderLogin() {
  return render(
    <BrowserRouter>
      <Login />
    </BrowserRouter>
  );
}

describe('Login page', () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it('renders login form', () => {
    renderLogin();
    expect(screen.getByText('PG Dash')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('button is disabled when fields are empty', () => {
    renderLogin();
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
  });

  it('calls login on form submit', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderLogin();
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin', 'secret');
    });
  });

  it('shows error on failed login', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();

    renderLogin();
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('shows loading state during login', async () => {
    // Login that never resolves
    mockLogin.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();

    renderLogin();
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Signing in...')).toBeInTheDocument();
    });
  });
});
