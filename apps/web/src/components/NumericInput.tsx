'use client';

import { useRef, useState } from 'react';

interface Props {
  value: number | string;
  onChange: (val: number) => void;
  min?: number;
  step?: number | string;
  className?: string;
  required?: boolean;
  placeholder?: string;
  decimals?: number; // max decimal places shown when formatted (default: 4)
}

function formatComma(raw: string, decimals: number): string {
  if (raw === '' || raw === '-') return raw;
  const [intPart, decPart] = raw.split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (decPart !== undefined) {
    return `${intFormatted}.${decPart.slice(0, decimals)}`;
  }
  return intFormatted;
}

function stripComma(s: string) {
  return s.replace(/,/g, '');
}

export function NumericInput({
  value, onChange, min, step, className = '', required, placeholder, decimals = 4,
}: Props) {
  const raw = String(value === 0 ? '' : value ?? '').replace(/,/g, '');
  const [display, setDisplay] = useState(() => formatComma(String(value ?? '').replace(/,/g, ''), decimals));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  function handleFocus() {
    setFocused(true);
    // Show raw number without commas for easy editing
    setDisplay(String(value ?? '').replace(/,/g, ''));
    setTimeout(() => ref.current?.select(), 0);
  }

  function handleBlur() {
    setFocused(false);
    const stripped = stripComma(display);
    const num = parseFloat(stripped);
    if (!isNaN(num)) {
      onChange(num);
      setDisplay(formatComma(stripped, decimals));
    } else {
      onChange(0);
      setDisplay('');
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = stripComma(e.target.value);
    // Allow: digits, one dot, leading minus
    if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;

    if (focused) {
      // While editing, just show with commas re-inserted
      const [intPart, decPart] = raw.split('.');
      const intFormatted = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      setDisplay(decPart !== undefined ? `${intFormatted}.${decPart}` : intFormatted);
    }

    const num = parseFloat(raw);
    if (!isNaN(num)) onChange(num);
    else if (raw === '' || raw === '-') onChange(0);
  }

  // Keep display in sync when value changes externally (not while focused)
  if (!focused) {
    const expected = formatComma(String(value ?? '').replace(/,/g, ''), decimals);
    if (display !== expected) setDisplay(expected);
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      min={min}
      required={required}
      placeholder={placeholder}
      className={className}
    />
  );
}
