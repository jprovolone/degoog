const STORE_TAB = "store";

const _openStoreTab = (): void => {
  document.querySelector<HTMLButtonElement>(`[data-tab="${STORE_TAB}"]`)?.click();
};

export const StoreLinkButton = ({ label }: { label: string }): JSX.Element => (
  <button class="degoog-link-btn" type="button" data-switch-tab={STORE_TAB} onClick={_openStoreTab}>
    {label}
  </button>
);
