import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRetryShortcut } from './useRetryShortcut';
afterEach(cleanup);
it('reuses retry only when valid, ignoring typing, modifiers and repeated keys', () => {
  const retry = vi.fn();
  const { rerender } = renderHook(({ valid }) => useRetryShortcut(valid, retry), { initialProps: { valid: true } });
  const press = (options: KeyboardEventInit = {}, target: EventTarget = window) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, ...options })); });
  for (const options of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) press(options);
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    const element = document.createElement(tag); if (tag === 'div') element.setAttribute('contenteditable', 'true');
    document.body.append(element); press({}, element); element.remove();
  }
  expect(retry).not.toHaveBeenCalled(); press(); expect(retry).toHaveBeenCalledTimes(1);
  rerender({ valid: false }); press(); expect(retry).toHaveBeenCalledTimes(1);
});
