import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface ColorPickerProps {
  label: string;
  value: string;
  open: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}

const COLOR_OPTIONS = [
  '#ffffff',
  '#111318',
  '#ff4d5e',
  '#ffb44d',
  '#2fd3a5',
  '#5b8cff',
  '#8fa3ff',
  '#b57bff',
];

function normalizeColor(value: string) {
  const hex = value.slice(0, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : '#ffffff';
}

export function ColorPicker({
  label,
  value,
  open,
  disabled = false,
  onChange,
  onOpenChange,
}: ColorPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedValue = normalizeColor(value);
  const [draft, setDraft] = useState(normalizedValue.toUpperCase());

  useEffect(() => {
    setDraft(normalizedValue.toUpperCase());
  }, [normalizedValue]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open, onOpenChange]);

  const applyDraft = () => {
    const next = normalizeColor(draft);
    setDraft(next.toUpperCase());
    onChange(next);
    onOpenChange(false);
  };

  return (
    <div className="color-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="color-picker__trigger"
        disabled={disabled}
        type="button"
        onClick={() => onOpenChange(!open)}
      >
        <span
          aria-hidden="true"
          className="color-picker__swatch"
          style={{ backgroundColor: normalizedValue }}
        />
        <span>{label}</span>
      </button>
      {open && !disabled && (
        <div
          aria-label={`${label}颜色选择器`}
          className="color-picker__popover"
          role="dialog"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onOpenChange(false);
          }}
        >
          <div className="color-picker__palette">
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                aria-label={`${label} ${color}`}
                aria-pressed={normalizedValue === color}
                className="color-picker__option"
                type="button"
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  onOpenChange(false);
                }}
              >
                {normalizedValue === color && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
          <label className="color-picker__hex">
            <span>HEX</span>
            <input
              aria-label={`${label} HEX 值`}
              maxLength={7}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyDraft();
              }}
            />
          </label>
          <button className="color-picker__apply" type="button" onClick={applyDraft}>
            应用颜色
          </button>
        </div>
      )}
    </div>
  );
}

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ label, checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={`toggle-switch ${checked ? 'toggle-switch--checked' : ''}`}
      role="switch"
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="toggle-switch__track">
        <span className="toggle-switch__thumb" />
      </span>
    </button>
  );
}

interface SelectionCheckboxProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

export function SelectionCheckbox({ label, checked, onChange }: SelectionCheckboxProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`selection-checkbox ${checked ? 'selection-checkbox--checked' : ''}`}
      role="checkbox"
      type="button"
      onClick={onChange}
    >
      {checked && <Icon name="check" size={11} />}
    </button>
  );
}
