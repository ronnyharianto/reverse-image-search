import { STATUS_LABELS, STATUS_STYLES, type ImageStatus } from "@/types/scanner";

export default function StatusBadge({ status }: { status: ImageStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
