import * as React from "react";

const FORMATTER = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: Array<{ readonly limit: number; readonly divisor: number; readonly unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, divisor: 1, unit: "second" },
  { limit: 3600, divisor: 60, unit: "minute" },
  { limit: 86_400, divisor: 3600, unit: "hour" },
  { limit: 604_800, divisor: 86_400, unit: "day" },
  { limit: 2_629_800, divisor: 604_800, unit: "week" },
  { limit: 31_557_600, divisor: 2_629_800, unit: "month" },
  { limit: Number.POSITIVE_INFINITY, divisor: 31_557_600, unit: "year" },
];

const formatRelative = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.length === 0) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const deltaSeconds = (date.getTime() - Date.now()) / 1000;
  const absDelta = Math.abs(deltaSeconds);

  for (const { limit, divisor, unit } of UNITS) {
    if (absDelta < limit) {
      return FORMATTER.format(Math.round(deltaSeconds / divisor), unit);
    }
  }

  return date.toLocaleString();
};

export const RelativeTime = ({ value }: { readonly value: string | null | undefined }) => {
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <time dateTime={value} title={new Date(value).toLocaleString()} className="text-foreground/90">
      {formatRelative(value)}
    </time>
  );
};
