import { LeakItem, type LeakItemProps } from "./leak-item";

export interface LeakListProps {
  intro: string;
  outro: string;
  items: LeakItemProps[];
}

export const LeakList = ({ intro, outro, items }: LeakListProps): JSX.Element => (
  <div>
    <p>{intro}</p>
    <ul>
      {items.map((item) => (
        <LeakItem {...item} />
      ))}
    </ul>
    <p>{outro}</p>
  </div>
);
