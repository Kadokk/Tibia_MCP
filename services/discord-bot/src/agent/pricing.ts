const IN_PER_MTOK = 1.0,
  OUT_PER_MTOK = 5.0;

export function costUsdMicros(u: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  const usd =
    (u.input_tokens * IN_PER_MTOK +
      (u.cache_creation_input_tokens ?? 0) * IN_PER_MTOK * 1.25 +
      (u.cache_read_input_tokens ?? 0) * IN_PER_MTOK * 0.1 +
      u.output_tokens * OUT_PER_MTOK) /
    1_000_000;
  return Math.ceil(usd * 1_000_000);
}
