import type { Child } from "../../shared/ui/tribute/types";

export const ResultsForm = ({
  action,
  method,
  hidden,
  children,
}: {
  action: string;
  method: string;
  hidden: [string, string][];
  children?: Child;
}): JSX.Element => (
  <form class="nojs-results-form" action={action} method={method} role="search">
    {children}
    {hidden.map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
  </form>
);
