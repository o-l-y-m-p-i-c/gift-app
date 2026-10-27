import { InlineStack, Spinner } from "@shopify/polaris";

/** On/off switch (Polaris has none). Shows a spinner and ignores clicks while `loading`. */
export function Switch({
  checked,
  onChange,
  label,
  loading = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const inactive = loading || disabled;
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-busy={loading}
        disabled={inactive}
        onClick={() => onChange(!checked)}
        style={{
          width: "52px",
          height: "30px",
          padding: "3px",
          border: "0",
          borderRadius: "999px",
          backgroundColor: checked ? "#008060" : "#8c9196",
          display: "flex",
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          cursor: inactive ? "default" : "pointer",
          opacity: inactive ? 0.6 : 1,
          transition: "background-color 150ms ease",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
          }}
        />
      </button>
      {loading && <Spinner size="small" accessibilityLabel={label} />}
    </InlineStack>
  );
}
