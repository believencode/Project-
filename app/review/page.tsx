"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewSheet } from "@/components/ReviewSheet";
import { SheetSummary } from "@/components/SheetSummary";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

export default function ReviewPage() {
  const { business, goLive } = useStore();
  const { t } = useT();
  const router = useRouter();
  const [byHand, setByHand] = useState(false);
  if (!business) return <NeedsBusiness />;
  // Setup left unfinished: this page is where the owner approves and goes live.
  const finishing = !business.live;
  const approve = () => {
    void goLive();
    router.push("/live");
  };
  return (
    <main className="page">
      {byHand ? (
        <>
          <button className="ghost" onClick={() => setByHand(false)}>{t("back")}</button>
          <ReviewSheet mode={finishing ? "wizard" : "edit"} onDone={finishing ? approve : () => setByHand(false)} />
        </>
      ) : (
        <SheetSummary mode={finishing ? "wizard" : "edit"} onApprove={finishing ? approve : undefined} onEditDetails={() => setByHand(true)} />
      )}
    </main>
  );
}
