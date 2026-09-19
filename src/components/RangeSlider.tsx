import React, { useEffect, useRef, useState } from 'react';

interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  snapToDefault?: boolean;
  valueText?: string;
  valueControl?: React.ReactNode;
  scaleLabels?: [string, string, string];
  onChange: (value: number) => void;
  onCommit?: (value: number, previousValue: number) => void | Promise<void>;
  disabled?: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stepPrecision(step: number) {
  const decimal = String(step).split('.')[1];
  return decimal ? decimal.length : 0;
}

export function RangeSlider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  snapToDefault = false,
  valueText,
  valueControl,
  scaleLabels,
  onChange,
  onCommit,
  disabled = false,
}: RangeSliderProps) {
  const [dragging, setDragging] = useState(false);
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const dragStartValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const commitVersionRef = useRef(0);
  const range = Math.max(max - min, 0.000001);
  const normalizedValue = clamp(Number.isFinite(value) ? value : min, min, max);
  const renderedValue = draftValue === null ? normalizedValue : draftValue;
  const percentage = ((renderedValue - min) / range) * 100;
  const defaultPercentage = defaultValue === undefined
    ? null
    : ((clamp(defaultValue, min, max) - min) / range) * 100;
  const displayValue = valueText || String(renderedValue);

  useEffect(() => {
    if (!draggingRef.current && draftValue !== null && normalizedValue === draftValue) {
      setDraftValue(null);
    }
  }, [draftValue, normalizedValue]);

  useEffect(() => {
    if (!draggingRef.current) setDraftValue(null);
  }, [normalizedValue]);

  const normalize = (nextValue: number, allowSnap: boolean) => {
    const stepped = min + Math.round((clamp(nextValue, min, max) - min) / step) * step;
    const rounded = Number(stepped.toFixed(stepPrecision(step)));
    if (
      allowSnap
      && snapToDefault
      && defaultValue !== undefined
      && Math.abs(rounded - defaultValue) <= range * 0.025
    ) {
      return defaultValue;
    }
    return clamp(rounded, min, max);
  };

  const updateFromPointer = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) {
      return latestValueRef.current;
    }
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const nextValue = normalize(min + ratio * range, true);
    if (nextValue === latestValueRef.current) {
      return nextValue;
    }
    latestValueRef.current = nextValue;
    setDraftValue(nextValue);
    onChange(nextValue);
    return nextValue;
  };

  const commitValue = (nextValue: number, previousValue: number) => {
    if (!onCommit) return;
    commitVersionRef.current += 1;
    const version = commitVersionRef.current;
    const clearDraft = () => {
      if (!draggingRef.current && commitVersionRef.current === version) {
        setDraftValue(null);
      }
    };
    try {
      Promise.resolve(onCommit(nextValue, previousValue)).then(clearDraft, clearDraft);
    } catch (error) {
      clearDraft();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      // Synthetic pointer events used by accessibility tools may not own a pointer.
    }
    draggingRef.current = true;
    dragStartValueRef.current = normalizedValue;
    latestValueRef.current = normalizedValue;
    setDragging(true);
    updateFromPointer(event.clientX, event.currentTarget);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    updateFromPointer(event.clientX, event.currentTarget);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) {
      updateFromPointer(event.clientX, event.currentTarget);
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      // Releasing an already-lost capture should not cancel the committed value.
    }
    draggingRef.current = false;
    setDragging(false);
    commitValue(latestValueRef.current, dragStartValueRef.current);
  };

  const handlePointerCancel = () => {
    draggingRef.current = false;
    setDragging(false);
    commitValue(latestValueRef.current, dragStartValueRef.current);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let nextValue: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextValue = normalizedValue - step;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextValue = normalizedValue + step;
    } else if (event.key === 'PageDown') {
      nextValue = normalizedValue - step * 10;
    } else if (event.key === 'PageUp') {
      nextValue = normalizedValue + step * 10;
    } else if (event.key === 'Home') {
      nextValue = min;
    } else if (event.key === 'End') {
      nextValue = max;
    }

    if (nextValue !== null) {
      event.preventDefault();
      const committedValue = normalize(nextValue, false);
      setDraftValue(committedValue);
      latestValueRef.current = committedValue;
      onChange(committedValue);
      commitValue(committedValue, normalizedValue);
    }
  };

  return (
    <div className={`range-field ${scaleLabels ? 'range-field--with-scale' : ''}`}>
      <span className="range-field__label">{label}</span>
      <div className="range-slider-column">
        <div
          aria-label={label}
          aria-disabled={disabled}
          aria-valuemax={max}
          aria-valuemin={min}
          aria-valuenow={renderedValue}
          aria-valuetext={displayValue}
          className={`range-slider ${dragging ? 'range-slider--dragging' : ''}`}
          onKeyDown={handleKeyDown}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="slider"
          tabIndex={disabled ? -1 : 0}
        >
          <span className="range-slider__track">
            <span className="range-slider__fill" style={{ width: `${percentage}%` }} />
            {defaultPercentage !== null && (
              <span className="range-slider__default" style={{ left: `${defaultPercentage}%` }} />
            )}
            <span className="range-slider__thumb" style={{ left: `${percentage}%` }}>
              <span className="range-slider__bubble">{displayValue}</span>
            </span>
          </span>
        </div>
        {scaleLabels && (
          <div className="range-slider__scale" aria-hidden="true">
            <span>{scaleLabels[0]}</span>
            <span>{scaleLabels[1]}</span>
            <span>{scaleLabels[2]}</span>
          </div>
        )}
      </div>
      <div className="range-field__value">
        {valueControl || <output>{displayValue}</output>}
      </div>
    </div>
  );
}
