export interface LeakItemProps {
  kind: string;
  host: string;
  url: string;
  from: string;
}

export const LeakItem = ({ kind, host, url, from }: LeakItemProps): JSX.Element => (
  <li>
    <strong>{kind}</strong> {host}
    <br />
    <code>{url}</code>
    <br />
    <small>{from}</small>
  </li>
);
