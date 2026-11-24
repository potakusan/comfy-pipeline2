import { Suspense } from "react";
import { ReleaseScreen } from "@/components/release/release-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReleaseScreen />
    </Suspense>
  );
}
