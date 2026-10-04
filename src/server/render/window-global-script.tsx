import { renderHtml } from "../../shared/ui/tribute/html";
import { RawDogIt } from "../../shared/ui/tribute/rawdogit";
import { scriptJson } from "./substitute";

export const WindowGlobalScript = ({
  name,
  value,
}: {
  name: string;
  value: unknown;
}): JSX.Element => (
  <script>
    <RawDogIt html={`window.${name}=${scriptJson(value)}`} />
  </script>
);

export const windowGlobalScript = (name: string, value: unknown): string =>
  renderHtml(<WindowGlobalScript name={name} value={value} />);
