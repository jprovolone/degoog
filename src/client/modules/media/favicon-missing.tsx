export const FaviconMissing = ({ tip }: { tip: string }): JSX.Element => (
  <span
    class="result-favicon-missing degoog-result--favicon-missing"
    data-tooltip={tip}
    data-tooltip-start={true}
    aria-label={tip}
    role="img"
  >
    <i class="fa-solid fa-ghost" aria-hidden="true"></i>
  </span>
);
