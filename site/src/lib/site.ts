export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base}${path.replace(/^\/+/, "")}`;
}

export function publicDataHref(path: string): string {
  return withBase(`public_data/${path.replace(/^\/+/, "")}`);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) {
    return value.toExponential(2);
  }

  return new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: 4,
  }).format(value);
}

export function formatPValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  if (value === 0) {
    return "0";
  }
  return value < 0.001 ? value.toExponential(2) : value.toPrecision(3);
}

export function labelFromIdentifier(identifier: string): string {
  return identifier
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
