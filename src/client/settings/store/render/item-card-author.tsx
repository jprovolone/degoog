import type { StoreItem } from "../../../types/store-tab";
import { linkHref } from "../../../../shared/utils/url";

export const ItemCardAuthor = ({ item }: { item: StoreItem }): JSX.Element => {
  const author = item.author;
  if (author?.url) {
    return (
      <a href={linkHref(author.url)} target="_blank" rel="noopener">
        {author.name}
      </a>
    );
  }
  return <>{author?.name || "-"}</>;
};
