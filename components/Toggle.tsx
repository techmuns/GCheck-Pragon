"use client";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}

// A compact on-brand switch. Navy when on, neutral when off.
export default function Toggle({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition"
      style={{
        backgroundColor: checked ? "#27457E" : "#CBD3E0",
        boxShadow: checked ? "inset 0 0 0 1px rgba(228,198,124,0.35)" : "none",
      }}
    >
      <span
        className="inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition"
        style={{ transform: checked ? "translateX(19px)" : "translateX(3px)" }}
      />
    </button>
  );
}
