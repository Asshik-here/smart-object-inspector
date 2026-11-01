export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="json">
      {JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}
    </pre>
  );
}
