import { LoadingSkeleton } from '@/components/ui/Feedback';

export default function Loading() {
  return (
    <div className="workspace-page" aria-busy="true" aria-live="polite">
      <LoadingSkeleton rows={4} />
    </div>
  );
}
