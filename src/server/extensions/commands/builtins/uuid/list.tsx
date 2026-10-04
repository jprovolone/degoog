export const UuidList = ({
  uuids,
  copyLabel,
  copiedLabel,
}: {
  uuids: string[];
  copyLabel?: string;
  copiedLabel?: string;
}): JSX.Element => (
  <div class="command-result command-uuid">
    {uuids.map((uuid) => (
      <div key={uuid} class="uuid-row">
        <code class="uuid-value">{uuid}</code>
        {copyLabel ? (
          <button type="button" class="uuid-copy" data-uuid={uuid} data-copied={copiedLabel}>
            {copyLabel}
          </button>
        ) : null}
      </div>
    ))}
  </div>
);
