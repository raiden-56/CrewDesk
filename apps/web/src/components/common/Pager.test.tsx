import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pager } from './Pager';

describe('Pager', () => {
  it('shows the visible range and disables the edges', () => {
    render(<Pager page={1} pageSize={20} total={45} onPage={() => undefined} />);
    expect(screen.getByText('1–20 of 45')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('moves between pages', async () => {
    const onPage = vi.fn();
    render(<Pager page={3} pageSize={20} total={45} onPage={onPage} />);
    expect(screen.getByText('41–45 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('handles an empty list', () => {
    render(<Pager page={1} pageSize={20} total={0} onPage={() => undefined} />);
    expect(screen.getByText('0–0 of 0')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 1')).toBeInTheDocument();
  });
});
