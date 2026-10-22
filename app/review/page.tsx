"use client";

import { useState } from "react";
import { ReviewSheet } from "@/components/ReviewSheet";
import { SheetSummary } from "@/components/SheetSummary";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import { useStore } from "@/lib/store";

export default function ReviewPage() {
  const { business } = useStore();
  const [byHand, setByHand] = useState(false);
  if (!business) return <NeedsBusiness />;
  return (
    <main className="page">
      {byHand ? (
        <>
          <button className="ghost" onClick={() => setByHand(false)}>← Back to summary</button>
          <ReviewSheet mode="edit" onDone={() => setByHand(false)} />
        </>
      ) : (
        <SheetSummary mode="edit" onEditDetails={() => setByHand(true)} />
      )}
    </main>
  );
}
