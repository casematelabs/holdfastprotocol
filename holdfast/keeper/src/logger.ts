export type LogLevel = "info" | "warn" | "error";

function serialiseValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(payload, (_, value) => serialiseValue(value));
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}
