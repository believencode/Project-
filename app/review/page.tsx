"use client";

import { ReviewSheet } from "@/components/ReviewSheet";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import { useStore } from "@/lib/store";

export default function ReviewPage() {
  const { business } = useStore();
  if (!business) return <NeedsBusiness />;
  return (
    <main className="page">
      <ReviewSheet mode="edit" onDone={() => {}} />
    </main>
  );
}
