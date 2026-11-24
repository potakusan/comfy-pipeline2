import { Suspense } from "react";
import { MosaicScreen } from "@/components/mosaic/mosaic-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MosaicScreen />
    </Suspense>
  );
}
