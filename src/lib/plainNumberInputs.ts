/**
 * Makes every <input type="number"> behave like a plain text-entry box:
 *  - mouse-wheel scrolling over a focused field never nudges the value up / down
 *  - ArrowUp / ArrowDown never step the value
 * (The spinner buttons themselves are hidden in index.css.)
 */
export function installPlainNumberInputs(): void {
  if (typeof document === 'undefined') return;

  const isNumberInput = (t: EventTarget | null): t is HTMLInputElement =>
    t instanceof HTMLInputElement && t.type === 'number';

  document.addEventListener(
    'wheel',
    (e) => {
      if (isNumberInput(e.target) && document.activeElement === e.target) {
        // Blur so the wheel scrolls the page instead of changing the amount.
        e.target.blur();
      }
    },
    { passive: true }
  );

  document.addEventListener('keydown', (e) => {
    if (isNumberInput(e.target) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
    }
  });
}
