"use client";

import { useId } from "react";

const FIELD =
  "w-full rounded-sm border border-border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted transition-colors hover:border-muted focus:border-brand";

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1 block text-sm leading-none text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  className = "",
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1 block text-sm leading-none text-muted"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={`${FIELD} appearance-none bg-[length:auto] pr-7`}
        style={{
          backgroundImage:
            "linear-gradient(45deg, transparent 50%, #5b6472 50%), linear-gradient(135deg, #5b6472 50%, transparent 50%)",
          backgroundPosition:
            "calc(100% - 14px) calc(50% + 1px), calc(100% - 10px) calc(50% + 1px)",
          backgroundSize: "4px 4px, 4px 4px",
          backgroundRepeat: "no-repeat",
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
